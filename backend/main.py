# backend/main.py
import os
import logging # Import logging
from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv

# Import the chat router
from routers import chat as chat_router

# Import the Qdrant service instance (to ensure it initializes on startup)
# We don't directly use it in main.py yet, but importing ensures connection check
try:
    from services.qdrant_service import qdrant_service
    if qdrant_service is None:
        logging.critical("Qdrant service failed to initialize. API might not function correctly.")
        # Optionally exit or disable certain features
except ImportError as e:
     logging.critical(f"Failed to import Qdrant service: {e}", exc_info=True)
     qdrant_service = None # Ensure variable exists even if import fails

try:
    from services.together_service import together_service
    together_status = "Initialized" if together_service else "Failed to Initialize"
except ImportError as e:
     logging.critical(f"Failed to import Together service: {e}", exc_info=True)
     together_service = None
     together_status = "Import Failed"

# Load environment variables from .env file
load_dotenv()

# Setup basic logging configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---- Configuration ----
QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY")

# ---- FastAPI App Instance ----
app = FastAPI(
    title="Sugar AI Prototype Backend",
    description="Backend API for RAG operations with Qdrant and Together AI",
    version="0.1.0",
)

# ---- Include Routers ----
app.include_router(chat_router.router) # Include the chat endpoints

# ---- API Endpoints (Keep root endpoint here) ----
@app.get("/", tags=["Health Check"])
async def read_root():
    """Root endpoint providing a simple health check."""
    # Check Qdrant service status if initialized
    qdrant_status = "Initialized" if qdrant_service else "Failed to Initialize"
    together_status = "Initialized" if together_service else "Failed to Initialize"
    return {
        "message": "Welcome to the Sugar AI Backend!",
        "qdrant_service_status": qdrant_status,
        "together_service_status": together_status,
        }

@app.get("/config-check", tags=["Health Check"])
async def check_config():
    # ... (keep existing config check endpoint)
    return {
        "qdrant_url_set": bool(QDRANT_URL),
        "qdrant_key_set": bool(QDRANT_API_KEY),
        "together_key_set": bool(TOGETHER_API_KEY),
    }



# ---- Startup Event (Optional: Verify Qdrant Connection Here Too) ----
# @app.on_event("startup")
# async def startup_event():
#     logger.info("Application startup...")
#     if qdrant_service:
#         logger.info("Qdrant service seems initialized.")
#         # You could add a ping to Qdrant here if needed
#     else:
#         logger.warning("Qdrant service was not initialized.")