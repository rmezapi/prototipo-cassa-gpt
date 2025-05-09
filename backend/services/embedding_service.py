# backend/services/embedding_service.py
import os
import logging
import torch
import numpy as np
from dotenv import load_dotenv
from fastapi import HTTPException
from tenacity import retry, stop_after_attempt, wait_random_exponential # For retries
from fastapi.concurrency import run_in_threadpool

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Configuration ---
# Model ID for the desired multilingual model
DEFAULT_MULTILINGUAL_MODEL_ID = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
MODEL_ID = os.getenv("MULTILINGUAL_EMBEDDING_MODEL_ID", DEFAULT_MULTILINGUAL_MODEL_ID)

# --- Expected Dimension (CRUCIAL for Qdrant) ---
# For sentence-transformers/paraphrase-multilingual-mpnet-base-v2, it's 768
EXPECTED_EMBEDDING_DIMENSION = 768

# Initialize the model
try:
    from sentence_transformers import SentenceTransformer
    logger.info(f"Loading SentenceTransformer model: {MODEL_ID}")
    model = SentenceTransformer(MODEL_ID)
    logger.info(f"SentenceTransformer model loaded successfully")
except ImportError:
    logger.error("sentence_transformers package not installed. Please install with: pip install sentence-transformers")
    model = None
except Exception as e:
    logger.error(f"Error loading SentenceTransformer model: {e}")
    model = None

# --- Service Class ---
class EmbeddingService:

    # Retry decorator for handling transient errors
    @retry(wait=wait_random_exponential(min=1, max=30), stop=stop_after_attempt(4))
    async def get_embeddings(self, texts: list[str]) -> list[list[float]]:
        """
        Generates embeddings for a list of texts using the sentence-transformers library directly.

        Args:
            texts: A list of text strings to embed.

        Returns:
            A list of embedding vectors (list of floats), corresponding to the input texts.

        Raises:
            HTTPException: If the embedding generation fails.
        """
        if not texts:
            logger.warning("get_embeddings called with empty text list.")
            return []

        # Ensure input is a list, even if only one text
        if not isinstance(texts, list):
            logger.error(f"Invalid input type for texts: {type(texts)}. Expected list.")
            raise HTTPException(status_code=400, detail="Invalid input format: texts must be a list.")

        # Check if model is loaded
        if model is None:
            logger.error("SentenceTransformer model is not loaded.")
            raise HTTPException(status_code=503, detail="Embedding service is not available. Model could not be loaded.")

        logger.info(f"Generating embeddings for {len(texts)} texts using model {MODEL_ID}...")

        try:
            # Run the embedding generation in a thread pool to avoid blocking
            def _generate_embeddings():
                # Generate embeddings using the sentence-transformers model
                embeddings = model.encode(texts, convert_to_numpy=True)
                # Convert numpy arrays to Python lists for JSON serialization
                return embeddings.tolist()

            # Run in thread pool to avoid blocking the event loop
            result = await run_in_threadpool(_generate_embeddings)

        except Exception as e:
            logger.error(f"Error generating embeddings: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to generate embeddings: {str(e)}")

        # Validate the structure of the result
        if not isinstance(result, list):
            logger.error(f"Unexpected embedding format. Type: {type(result)}")
            raise HTTPException(status_code=500, detail="Received unexpected embedding format.")

        # Validate the number of embeddings returned
        if len(result) != len(texts):
            logger.error(f"Mismatch in embedding count: Expected {len(texts)}, Got {len(result)}")
            raise HTTPException(status_code=500, detail="Mismatch between input texts and received embeddings.")

        # Validate the dimension of the first embedding
        if result and len(result[0]) != EXPECTED_EMBEDDING_DIMENSION:
            logger.error(f"CRITICAL: Embedding dimension mismatch! Expected {EXPECTED_EMBEDDING_DIMENSION}, Got {len(result[0])} for model {MODEL_ID}")
            # This is a critical error as it will break Qdrant storage
            raise HTTPException(status_code=500, detail=f"Internal configuration error: Embedding dimension mismatch (Expected {EXPECTED_EMBEDDING_DIMENSION}).")

        logger.info(f"Successfully generated {len(result)} embeddings using model {MODEL_ID}.")
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