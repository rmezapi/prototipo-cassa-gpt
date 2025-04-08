# backend/main.py
import os
from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# ---- Configuration ----
# Check if essential environment variables are set (optional but good practice)
QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY")

# Simple check - in a real app, you might validate more thoroughly
# if not all([QDRANT_URL, QDRANT_API_KEY, TOGETHER_API_KEY]):
#     print("Warning: Essential environment variables are missing!")
#     # Depending on your setup, you might raise an exception here
#     # raise EnvironmentError("Essential environment variables are missing!")

# ---- FastAPI App Instance ----
app = FastAPI(
    title="Sugar AI Prototype Backend",
    description="Backend API for RAG operations with Qdrant and Together AI",
    version="0.1.0",
)

# ---- API Endpoints ----
@app.get("/", tags=["Health Check"])
async def read_root():
    """Root endpoint providing a simple health check."""
    return {"message": "Welcome to the Sugar AI Backend!"}

@app.get("/config-check", tags=["Health Check"])
async def check_config():
    """Checks if API keys are loaded (only checks existence, not validity)."""
    # DO NOT return the actual keys in a real application!
    # This is just for initial setup verification.
    return {
        "qdrant_url_set": bool(QDRANT_URL),
        "qdrant_key_set": bool(QDRANT_API_KEY),
        "together_key_set": bool(TOGETHER_API_KEY),
    }

# Add more endpoints later for /chat, /upload, /conversation etc.

# ---- Uvicorn Entry Point (for running with `python main.py`) ----
# Optional: Allows running with `python main.py` but `uvicorn main:app --reload` is better for dev
# if __name__ == "__main__":
#     import uvicorn
#     uvicorn.run(app, host="0.0.0.0", port=8000)