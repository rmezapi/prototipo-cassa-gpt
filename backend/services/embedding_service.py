# backend/services/embedding_service.py
import os
import logging
import httpx # Use httpx for async HTTP requests
from dotenv import load_dotenv
from fastapi import HTTPException
from tenacity import retry, stop_after_attempt, wait_random_exponential # For retries

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Configuration ---
HF_TOKEN = os.getenv("HF_TOKEN")
# Model ID for the desired multilingual model on Hugging Face Hub
DEFAULT_MULTILINGUAL_MODEL_ID = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2" # Example
MODEL_ID = os.getenv("MULTILINGUAL_EMBEDDING_MODEL_ID", DEFAULT_MULTILINGUAL_MODEL_ID)

# Construct the Hugging Face Inference API URL for Feature Extraction
# Ensure this URL format is correct for your chosen model type
API_URL = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{MODEL_ID}"

# Set authorization header if token is available
HEADERS = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {}
if not HF_TOKEN:
    logger.warning("HF_TOKEN environment variable not set. Access to some HF models may be restricted.")

# --- Expected Dimension (CRUCIAL for Qdrant) ---
# You MUST verify this dimension from the model card on Hugging Face Hub
# For sentence-transformers/paraphrase-multilingual-mpnet-base-v2, it's 768
# For models like m2-bert-80M-8k-retrieval, it might be different (e.g., 768 or 384 - CHECK!)
EXPECTED_EMBEDDING_DIMENSION = 768 # *** UPDATE THIS VALUE BASED ON YOUR CHOSEN MODEL_ID ***

# --- Service Class ---
class EmbeddingService:

    # Retry decorator for handling transient network errors or API hiccups
    @retry(wait=wait_random_exponential(min=1, max=30), stop=stop_after_attempt(4))
    async def get_embeddings(self, texts: list[str]) -> list[list[float]]:
        """
        Generates embeddings for a list of texts using the Hugging Face Inference API.

        Args:
            texts: A list of text strings to embed.

        Returns:
            A list of embedding vectors (list of floats), corresponding to the input texts.

        Raises:
            HTTPException: If the API call fails or returns unexpected data.
        """
        if not texts:
            logger.warning("get_embeddings called with empty text list.")
            return []

        # Ensure input is a list, even if only one text
        if not isinstance(texts, list):
             logger.error(f"Invalid input type for texts: {type(texts)}. Expected list.")
             # Handle appropriately - raise error or try to convert? Raising is safer.
             raise HTTPException(status_code=400, detail="Invalid input format: texts must be a list.")

        logger.info(f"Requesting embeddings for {len(texts)} texts using HF model {MODEL_ID}...")

        try:
            # Use an async HTTP client for non-blocking requests
            async with httpx.AsyncClient(timeout=60.0) as client: # Set a reasonable timeout
                response = await client.post(
                    API_URL,
                    headers=HEADERS,
                    # Payload format for feature-extraction pipeline
                    json={
                        "inputs": texts,
                        "options": {
                            "wait_for_model": True, # Wait if the model isn't ready
                            "use_gpu": False # Optional: Set to True if you have access/need GPU on HF side
                            }
                    }
                )
                # Raise HTTP errors (4xx, 5xx)
                response.raise_for_status()
                # Parse the JSON response
                result = response.json()

        # --- Specific Error Handling ---
        except httpx.RequestError as e:
             # Errors during the request (network issue, DNS, etc.)
             logger.error(f"HF Inference API request error: {e}", exc_info=True)
             raise HTTPException(status_code=503, detail=f"Service Unavailable: Communication error with Embedding API: {e}")
        except httpx.HTTPStatusError as e:
             # Errors returned by the API (4xx client errors, 5xx server errors)
             logger.error(f"HF Inference API returned status {e.response.status_code}: {e.response.text}")
             detail = f"Embedding API Error ({e.response.status_code})"
             try: # Attempt to get more specific error message from HF response
                 error_detail = e.response.json().get("error", "")
                 if isinstance(error_detail, list): error_detail = " ".join(error_detail) # Handle list errors
                 if error_detail: detail += f": {error_detail}"
             except Exception: pass # Ignore if response isn't JSON or parsing fails
             # Use the original status code from the API response if possible
             raise HTTPException(status_code=e.response.status_code, detail=detail)
        except Exception as e:
             # Catch other potential errors (e.g., JSON decoding, unexpected issues)
             logger.error(f"Unexpected error during embedding generation: {e}", exc_info=True)
             raise HTTPException(status_code=500, detail=f"Internal error processing embeddings: {e}")

        # --- Process Successful Result ---
        # Validate the structure of the result (should be a list of embeddings)
        if not isinstance(result, list) or not all(isinstance(emb, list) for emb in result):
            logger.error(f"Unexpected embedding response format from HF API. Type: {type(result)}. Content: {str(result)[:200]}...")
            raise HTTPException(status_code=500, detail="Received unexpected embedding format from API.")

        # Validate the number of embeddings returned
        if len(result) != len(texts):
             logger.error(f"Mismatch in embedding count: Expected {len(texts)}, Got {len(result)}")
             raise HTTPException(status_code=500, detail="Mismatch between input texts and received embeddings.")

        # Optional but recommended: Validate the dimension of the first embedding
        if result and len(result[0]) != EXPECTED_EMBEDDING_DIMENSION:
            logger.error(f"CRITICAL: Embedding dimension mismatch! Expected {EXPECTED_EMBEDDING_DIMENSION}, Got {len(result[0])} for model {MODEL_ID}")
            # This is a critical error as it will break Qdrant storage
            raise HTTPException(status_code=500, detail=f"Internal configuration error: Embedding dimension mismatch (Expected {EXPECTED_EMBEDDING_DIMENSION}).")

        logger.info(f"Successfully received {len(result)} embeddings from HF API for model {MODEL_ID}.")
        return result

# --- Singleton Pattern ---
# Create a single instance of the service to be reused
try:
    # Check if the required dimension is set appropriately based on the chosen model
    if not isinstance(EXPECTED_EMBEDDING_DIMENSION, int) or EXPECTED_EMBEDDING_DIMENSION <= 0:
         raise ValueError(f"EXPECTED_EMBEDDING_DIMENSION is not configured correctly ({EXPECTED_EMBEDDING_DIMENSION}). Check model card for {MODEL_ID}.")
    embedding_service = EmbeddingService()
    logger.info(f"EmbeddingService initialized for model {MODEL_ID} with expected dimension {EXPECTED_EMBEDDING_DIMENSION}.")
except Exception as e:
    logger.critical(f"Could not initialize Embedding Service. Error: {e}", exc_info=True)
    embedding_service = None # Indicate failure