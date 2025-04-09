# backend/services/qdrant_service.py
from http.client import HTTPException
import os
import logging
from qdrant_client import QdrantClient, models
from qdrant_client.http.models import Distance, VectorParams, PointStruct
from dotenv import load_dotenv

load_dotenv() # Load environment variables

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
# We'll need embedding size later, get it from the model or hardcode for now
# Example size for models like 'all-MiniLM-L6-v2' or many BERT-based ones
# You might need to adjust this based on EMBEDDING_MODEL_NAME
EMBEDDING_DIMENSION = 768 # Example, ** ADJUST AS NEEDED **

class QdrantService:
    def __init__(self):
        if not QDRANT_URL:
            logger.error("QDRANT_URL environment variable not set.")
            raise ValueError("QDRANT_URL is required")

        try:
            # Use API Key only if it's provided (useful for local Qdrant instances without auth)
            if QDRANT_API_KEY:
                self.client = QdrantClient(
                    url=QDRANT_URL,
                    api_key=QDRANT_API_KEY,
                    timeout=60 # Increase timeout for potentially long operations
                )
            else:
                 self.client = QdrantClient(url=QDRANT_URL, timeout=60)
            logger.info(f"Connected to Qdrant at {QDRANT_URL}")
            self.ensure_collections_exist()
        except Exception as e:
            logger.error(f"Failed to connect to Qdrant: {e}", exc_info=True)
            raise

    def ensure_collections_exist(self):
        """Creates collections if they don't exist."""
        collections_to_ensure = {
            "collection_kb": VectorParams(size=EMBEDDING_DIMENSION, distance=Distance.COSINE),
            "collection_uploads": VectorParams(size=EMBEDDING_DIMENSION, distance=Distance.COSINE),
            "collection_chat_history": VectorParams(size=EMBEDDING_DIMENSION, distance=Distance.COSINE),
        }
        try:
            existing_collections = [col.name for col in self.client.get_collections().collections]
            logger.info(f"Existing Qdrant collections: {existing_collections}")

            for name, vector_params in collections_to_ensure.items():
                if name not in existing_collections:
                    logger.info(f"Creating collection: {name}")
                    self.client.recreate_collection(
                        collection_name=name,
                        vectors_config=vector_params
                    )
                else:
                    logger.info(f"Collection '{name}' already exists.")
        except Exception as e:
            logger.error(f"Failed during collection check/creation: {e}", exc_info=True)
            # Decide if you want to raise an exception or just log the error
            # raise

    def add_points(self, collection_name: str, points: list[PointStruct]):
        """Adds points (embeddings and payloads) to a specified collection."""
        if not points:
            logger.warning(f"Attempted to add empty list of points to {collection_name}")
            return None
        try:
            # Use wait=True for prototypes/smaller batches to ensure data is indexed
            # For high throughput, consider wait=False and handling potential eventual consistency
            operation_info = self.client.upsert(
                collection_name=collection_name,
                points=points,
                wait=True
            )
            logger.info(f"Upserted {len(points)} points to {collection_name}. Status: {operation_info.status}")
            return operation_info
        except Exception as e:
            logger.error(f"Failed to add points to {collection_name}: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to add data to {collection_name}")

    def search_points(self, collection_name: str, query_vector: list[float], limit: int = 5, query_filter: models.Filter = None):
        """Searches for points in a collection similar to the query vector."""
        try:
            search_result = self.client.search(
                collection_name=collection_name,
                query_vector=query_vector,
                query_filter=query_filter, # Apply filters (e.g., for conversation_id)
                limit=limit
            )
            logger.info(f"Search in {collection_name} found {len(search_result)} results.")
            return search_result
        except Exception as e:
            logger.error(f"Failed to search points in {collection_name}: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to search data in {collection_name}")

# --- Singleton Pattern ---
# Create a single instance of the service to be reused across the application
# This avoids reconnecting to Qdrant repeatedly.
try:
    qdrant_service = QdrantService()
except Exception as e:
    logger.critical(f"Could not initialize Qdrant Service. Exiting. Error: {e}", exc_info=True)
    # In a real app, you might handle this more gracefully or prevent startup
    qdrant_service = None # Indicate failure