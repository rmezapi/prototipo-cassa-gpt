# backend/services/together_service.py
import os
import logging
import together
from dotenv import load_dotenv
from fastapi import HTTPException
from tenacity import retry, stop_after_attempt, wait_random_exponential

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY")
# Get model names from env vars, provide defaults if not set
DEFAULT_EMBEDDING_MODEL = "togethercomputer/m2-bert-80M-8k-retrieval" # Example, check Together AI docs
DEFAULT_GENERATION_MODEL = "mistralai/Mixtral-8x7B-Instruct-v0.1" # Example
DEFAULT_IMAGE_CAPTION_MODEL = "Salesforce/blip-image-captioning-large" # Example if available

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL_NAME", DEFAULT_EMBEDDING_MODEL)
GENERATION_MODEL = os.getenv("GENERATION_MODEL_NAME", DEFAULT_GENERATION_MODEL)
# For image captioning - adjust model name based on availability on Together AI
IMAGE_CAPTION_MODEL = os.getenv("IMAGE_CAPTION_MODEL_NAME", DEFAULT_IMAGE_CAPTION_MODEL)

# Validate API Key
if not TOGETHER_API_KEY:
    logger.error("TOGETHER_API_KEY environment variable not set.")
    raise ValueError("TOGETHER_API_KEY is required for TogetherService")

# Initialize the Together client globally
try:
    together.api_key = TOGETHER_API_KEY
    # Optional: Validate connection by listing models (can increase startup time)
    # models_list = together.Models.list()
    # logger.info(f"Successfully connected to Together AI. Found {len(models_list)} models.")
    logger.info(f"Together AI client initialized. Using models - Embedding: {EMBEDDING_MODEL}, Generation: {GENERATION_MODEL}, Caption: {IMAGE_CAPTION_MODEL}")
except Exception as e:
    logger.error(f"Failed to initialize Together AI client: {e}", exc_info=True)
    raise

class TogetherService:

    # Use tenacity for retries on API calls to handle transient network issues
    @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(5))
    async def get_embeddings(self, texts: list[str], model: str = EMBEDDING_MODEL) -> list[list[float]]:
        """Generates embeddings for a list of texts using Together AI."""
        if not texts:
            return []
        try:
            logger.info(f"Requesting embeddings for {len(texts)} text chunks using model {model}...")
            response = await together.AsyncEmbedding.create(input=texts, model=model)
            # Validate response structure (adjust based on actual Together client response)
            if not response or not hasattr(response, 'data') or not response.data:
                 logger.error(f"Invalid embedding response format: {response}")
                 raise HTTPException(status_code=500, detail="Received invalid embedding response format from Together AI")

            embeddings = [item.embedding for item in response.data]
            logger.info(f"Successfully received {len(embeddings)} embeddings.")
            # Quick dimension check (optional) - compare with expected dimension
            # if embeddings and len(embeddings[0]) != EXPECTED_DIMENSION:
            #    logger.warning(f"Embedding dimension mismatch! Expected {EXPECTED_DIMENSION}, got {len(embeddings[0])}")
            return embeddings
        except Exception as e:
            logger.error(f"Failed to get embeddings from Together AI: {e}", exc_info=True)
            # Re-raise as HTTPException for FastAPI to handle
            raise HTTPException(status_code=502, detail=f"Failed to get embeddings from Together AI: {str(e)}") from e

    @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(3))
    async def generate_text(
        self,
        prompt: str,
        model: str = GENERATION_MODEL,
        max_tokens: int = 512,
        temperature: float = 0.7,
        top_p: float = 0.7,
        top_k: int = 50,
        repetition_penalty: float = 1.0
    ) -> str:
        """Generates text based on a prompt using Together AI's chat/completion endpoint."""
        try:
            logger.info(f"Requesting text generation using model {model}...")
            # Using Chat completion style for models like Mixtral/Mistral
            # Adjust if using a base model requiring the 'prompt' parameter directly
            response = await together.AsyncChat.create(
                model=model,
                messages=[{"role": "user", "content": prompt}], # Adjust role if needed
                max_tokens=max_tokens,
                temperature=temperature,
                top_p=top_p,
                top_k=top_k,
                repetition_penalty=repetition_penalty,
                # stream=False # Use stream=True later for streaming responses to UI
            )
            # Validate response structure (adjust based on actual Together client response)
            if not response or not response.choices or not response.choices[0].message or not response.choices[0].message.content:
                 logger.error(f"Invalid generation response format: {response}")
                 raise HTTPException(status_code=500, detail="Received invalid generation response format from Together AI")

            generated_text = response.choices[0].message.content.strip()
            logger.info("Successfully received generated text.")
            return generated_text
        except Exception as e:
            logger.error(f"Failed to generate text from Together AI: {e}", exc_info=True)
            raise HTTPException(status_code=502, detail=f"Failed to generate text from Together AI: {str(e)}") from e

    # Placeholder for image captioning - implementation depends heavily
    # on the specific model available and its API via the Together client.
    @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(3))
    async def get_image_caption(self, image_bytes: bytes, model: str = IMAGE_CAPTION_MODEL) -> str:
        """Generates a caption for an image using Together AI (Placeholder)."""
        logger.info(f"Requesting image caption using model {model}...")
        # THIS IS A HIGHLY SIMPLIFIED PLACEHOLDER - Check Together AI docs
        # for how to call image models. You might need to pass image data
        # differently (e.g., base64 encoded, specific input format).
        try:
            # Example structure - ** LIKELY INCORRECT - VERIFY WITH TOGETHER DOCS **
            # response = await together.AsyncImage.create(
            #     model=model,
            #     image=image_bytes, # This needs verification
            #     prompt="Generate a caption for this image.", # May not be needed
            # )
            # caption = response.caption # Adjust based on actual response field

            # ** TEMPORARY MOCK RESPONSE **
            logger.warning("Image captioning is using a mock response. Implement actual Together AI call.")
            mock_caption = f"Mock caption for image of size {len(image_bytes)} bytes."
            await asyncio.sleep(0.1) # Simulate network delay
            caption = mock_caption
            # ** END MOCK RESPONSE **

            if not caption:
                 logger.error(f"Received empty caption response")
                 raise HTTPException(status_code=500, detail="Received empty caption from Together AI")

            logger.info("Successfully received image caption.")
            return caption.strip()

        except NotImplementedError: # Or specific error from Together client if image model not standard
             logger.error(f"Image captioning model {model} might not be supported via standard API or implementation needed.")
             raise HTTPException(status_code=501, detail=f"Image captioning for model {model} not implemented or available")
        except Exception as e:
            logger.error(f"Failed to get image caption from Together AI: {e}", exc_info=True)
            raise HTTPException(status_code=502, detail=f"Failed to get image caption from Together AI: {str(e)}") from e

# --- Singleton Pattern ---
# Create a single instance of the service
try:
    together_service = TogetherService()
except Exception as e:
    logger.critical(f"Could not initialize Together Service. Exiting. Error: {e}", exc_info=True)
    together_service = None # Indicate failure

# Add asyncio import if needed for mock sleep
import asyncio