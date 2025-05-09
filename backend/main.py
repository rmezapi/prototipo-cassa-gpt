# backend/main.py
import os
import logging # Import logging
from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv
# In main.py or a config module
import cloudinary
import os
from fastapi.middleware.cors import CORSMiddleware


# Import the routers
from routers import chat as chat_router
from routers import upload as upload_router
from routers import knowledge_bases as kb_router

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

try:
    from services.embedding_service import embedding_service
    embedding_status = "Initialized" if embedding_service else "Failed to Initialize"
except ImportError as e:
     logging.critical(f"Failed to import Embedding service: {e}", exc_info=True)
     embedding_service = None
     embedding_status = "Import Failed"

# Load environment variables from .env file
load_dotenv()

# Setup basic logging configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---- Configuration ----
QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY")

# --- Initialize Cloudinary ---
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME")
CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET")

if all([CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET]):
    try:
        cloudinary.config(
          cloud_name = CLOUDINARY_CLOUD_NAME,
          api_key = CLOUDINARY_API_KEY,
          api_secret = CLOUDINARY_API_SECRET,
          secure = True # Use https
        )
        cloudinary_status = "Initialized"
        logger.info("Cloudinary client configured.")
    except Exception as e:
        logger.error(f"Failed to configure Cloudinary: {e}", exc_info=True)
        cloudinary_status = "Configuration Failed"
else:
    logger.warning("Cloudinary credentials missing in environment variables.")
    cloudinary_status = "Credentials Missing"
# --- End Cloudinary Init ---


# ---- FastAPI App Instance ----
app = FastAPI(
    title="Sugar AI Prototype Backend",
    description="Backend API for RAG operations with Qdrant and Together AI",
    version="0.1.0",
)

# --- Configure CORS ---
# Define the origins allowed to make requests.
# For development, allow localhost ports used by frontend and Swagger.
# For production, replace with your deployed frontend URL (e.g., from Netlify).
origins = [
    "http://localhost", # Allow base localhost
    "http://localhost:3000", # Default Remix dev port
    "http://localhost:5173", # Default Vite dev port (sometimes used)
    "http://localhost:5174", # Additional Vite dev port
    "http://localhost:8000", # Allow Swagger UI/API itself if needed
    # --- Add your deployed frontend origin (Netlify URL) when ready ---
    "https://cassagpt-demo.netlify.app",
    "https://prototipo-cassa-gpt-backend.onrender.com"
]
# If your backend might be deployed too, add its origin if different
# origins.append("https://your-backend-url.onrender.com")


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, # List of allowed origins
    allow_credentials=True, # Allow cookies if needed later
    allow_methods=["*"], # Allow all methods (GET, POST, PUT, DELETE, etc.)
    allow_headers=["*"], # Allow all headers
)
# --- End CORS Configuration ---

# ---- Include Routers ----
app.include_router(chat_router.router) # Include the chat endpoints
app.include_router(upload_router.router) # Include the upload endpoints
app.include_router(kb_router.router) # Include the knowledge base endpoints

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
        "cloudinary_status": cloudinary_status,
        "embedding_service_status": "Initialized" if 'embedding_service' in locals() and embedding_service else "Not Initialized" # Add status for embedding service
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