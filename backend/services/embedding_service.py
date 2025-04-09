# backend/services/embedding_service.py
import os
import logging
import httpx
from dotenv import load_dotenv
from fastapi import HTTPException
from tenacity import retry, stop_after_attempt, wait_random_exponential

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Configuration ---
HF_TOKEN = os.getenv("HF_TOKEN")
# Example Model - REPLACE with your chosen multilingual model's ID on Hugging Face Hub
DEFAULT_MULTILINGUAL_MODEL_ID = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
MODEL_ID = os.getenv("MULTILINGUAL_EMBEDDING_MODEL_ID", DEFAULT_MULTILINGUAL_MODEL_ID)
# Construct the HF Inference API URL
API_URL = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{MODEL_ID}"

if not HF_TOKEN:
    # Depending on model permissions, token might not be strictly needed, but good practice
    logger.warning("HF_TOKEN environment variable not set. Access to some models may be restricted.")
    # raise ValueError("HF_TOKEN is required for Hugging Face Inference API") # Or make optional

HEADERS = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {}

# Get expected dimension (Important for Qdrant!) - You MUST find this from the model card on Hugging Face
# For paraphrase-multilingual-mpnet-base-v2, it's 768
EXPECTED_EMBEDDING_DIMENSION = 768 # *** CHANGE THIS BASED ON YOUR MODEL ***


class EmbeddingService:
    # Retry logic for network issues
    @retry(wait=wait_random_exponential(min=1, max=30), stop=stop_after_attempt(4))
    async def get_embeddings(self, texts: list[str]) -> list[list[float]]:
        """Generates embeddings for a list of texts using HF Inference API."""
        if not texts:
            return []

        logger.info(f"Requesting embeddings for {len(texts)} texts using HF model {MODEL_ID}...")

        try:
            async with httpx.AsyncClient(timeout=60.0) as client: # Increased timeout
                response = await client.post(
                    API_URL,
                    headers=HEADERS,
                    json={
                        "inputs": texts,
                        "options": {"wait_for_model": True} # Wait if model is loading
                    }
                )
                response.raise_for_status() # Raise exception for 4xx/5xx errors
                result = response.json()

        except httpx.RequestError as e:
             logger.error(f"HF Inference API request failed: {e}", exc_info=True)
             raise HTTPException(status_code=502, detail=f"Failed communication with Embedding API: {e}")
        except httpx.HTTPStatusError as e:
             logger.error(f"HF Inference API returned error {e.response.status_code}: {e.response.text}")
             detail = f"Embedding API error ({e.response.status_code})"
             try: # Try to get more detail from HF error message
                 error_detail = e.response.json().get("error", "")
                 if error_detail: detail += f": {error_detail}"
             except: pass # Ignore if response isn't json
             raise HTTPException(status_code=e.response.status_code, detail=detail)
        except Exception as e:
             logger.error(f"Failed processing embedding response: {e}", exc_info=True)
             raise HTTPException(status_code=500, detail=f"Error processing embedding response: {e}")


        # --- Process Result ---
        # Check result format (HF API can vary slightly)
        if not isinstance(result, list) or not all(isinstance(emb, list) for emb in result):
            logger.error(f"Unexpected embedding response format from HF API: {type(result)}")
            raise HTTPException(status_code=500, detail="Received unexpected embedding format from API.")

        if len(result) != len(texts):
             logger.error(f"Mismatch in embedding count: Expected {len(texts)}, Got {len(result)}")
             raise HTTPException(status_code=500, detail="Mismatch between input texts and received embeddings.")

        # Optional: Verify embedding dimension
        if result and len(result[0]) != EXPECTED_EMBEDDING_DIMENSION:
            logger.warning(f"Unexpected embedding dimension! Expected {EXPECTED_EMBEDDING_DIMENSION}, Got {len(result[0])} for model {MODEL_ID}")
            # Decide if this is critical - might still work if Qdrant was configured differently
            # raise HTTPException(status_code=500, detail="Embedding dimension mismatch.")


        logger.info(f"Successfully received {len(result)} embeddings from HF API.")
        return result

# --- Singleton ---
try:
    embedding_service = EmbeddingService()
except Exception as e:
    logger.critical(f"Could not initialize Embedding Service. Error: {e}", exc_info=True)
    embedding_service = None