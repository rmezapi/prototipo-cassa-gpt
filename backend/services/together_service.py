# backend/services/together_service.py
import os
import logging
import together # Standard import
from dotenv import load_dotenv
from fastapi import HTTPException
# --- Import run_in_threadpool ---
from fastapi.concurrency import run_in_threadpool
from tenacity import retry, stop_after_attempt, wait_random_exponential
# No asyncio needed here if calls are sync
# import asyncio

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Credentials and Models ---
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY")
# ... (Model names remain the same) ...
VISION_MODEL = os.getenv("VISION_MODEL_NAME", "meta-llama/Llama-Vision-Free")
GENERATION_MODEL = os.getenv("GENERATION_MODEL_NAME", "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free")

if not TOGETHER_API_KEY:
    raise ValueError("TOGETHER_API_KEY is required")

# --- Initialize the standard (assumed synchronous) client ---
try:
    # Assuming this initializes a synchronous client
    together_client = together.Together(api_key=TOGETHER_API_KEY)
    logger.info(f"Synchronous Together AI client initialized...")
except Exception as e:
    logger.error(f"Failed to initialize Together AI client: {e}", exc_info=True)
    raise

UX_UI_DESCRIPTION_PROMPT = "You are a UX/UI designer. Describe the attached screenshot or UI mockup in detail. I will feed in the output you give me to a coding model that will attempt to recreate this mockup, so please think step by step and describe the UI in detail. Pay close attention to background color, text color, font size, font family, padding, margin, border, etc. Match the colors and sizes exactly. Make sure to mention every part of the screenshot including any headers, footers, etc. Use the exact text from the screenshot."
class TogetherService:
    # Inject the synchronous client
    def __init__(self, client=together_client):
         self.client = client

    # --- generate_text - WRAPPED for ASYNC CONTEXT ---
    # Method remains async def because it's called from async routes
    @retry(...)
    async def generate_text(self, prompt: str, model: str = GENERATION_MODEL, **kwargs) -> str:
        # Define a synchronous helper function to make the actual API call
        def _sync_generate():
            try:
                logger.info(f"(Sync Call) Requesting text generation model {model}...")
                # --- Make the SYNCHRONOUS call ---
                response = self.client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=kwargs.get('max_tokens', 1024),
                    temperature=kwargs.get('temperature', 0.7),
                    top_p=kwargs.get('top_p', 0.7),
                    top_k=kwargs.get('top_k', 50),
                    repetition_penalty=kwargs.get('repetition_penalty', 1.0),
                    # stream=False # Ensure stream is False for this pattern
                )
                # --- End Synchronous Call ---

                # Process response synchronously
                if not response or not response.choices or not response.choices[0].message or not response.choices[0].message.content:
                     logger.error(f"Invalid generation response format: {response}")
                     # Raise specific error to be caught by run_in_threadpool handling
                     raise ValueError("Received invalid generation response format")
                generated_text = response.choices[0].message.content.strip()
                logger.info("(Sync Call) Successfully received generated text.")
                return generated_text
            except Exception as e:
                 logger.error(f"(Sync Call) Error during Together AI generation: {e}", exc_info=True)
                 # Re-raise to be caught by run_in_threadpool handling
                 raise

        try:
            # --- Wrap the sync call in run_in_threadpool ---
            logger.info("Dispatching synchronous generate_text call to thread pool...")
            result = await run_in_threadpool(_sync_generate)
            logger.info("Received result from generate_text thread pool task.")
            return result
        except Exception as e:
             # Handle errors raised within the threadpool function
             logger.error(f"Error executing generate_text in thread pool: {e}", exc_info=True)
             # Convert general errors or the ValueError to HTTPException
             if isinstance(e, ValueError):
                 raise HTTPException(status_code=500, detail=str(e))
             else:
                 raise HTTPException(status_code=502, detail=f"Failed background task for text generation: {str(e)}")


    # --- get_image_description - WRAPPED for ASYNC CONTEXT ---
    # Method remains async def
    @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(3))
    async def get_image_description(self, image_url: str, model: str = VISION_MODEL) -> str:
        if not image_url:
            raise ValueError("Image URL is required.")
        if not self.client:
             raise HTTPException(status_code=503, detail="Together AI service not properly initialized.")

        # Define the synchronous helper function
        def _sync_describe():
            try:
                logger.info(f"(Sync Call) Requesting image description for {image_url} model {model}...")
                # --- Make the SYNCHRONOUS call ---
                response = self.client.chat.completions.create(
                    model=model,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": UX_UI_DESCRIPTION_PROMPT},
                                {"type": "image_url", "image_url": {"url": image_url}},
                            ],
                        }
                    ],
                    max_tokens=2048,
                )
                # --- End Synchronous Call ---

                # Process response synchronously
                if not response or not response.choices or not response.choices[0].message or not response.choices[0].message.content:
                    logger.error(f"Invalid image description response format: {response}")
                    raise ValueError("Received invalid image description response format") # Raise specific error
                description = response.choices[0].message.content.strip()
                logger.info(f"(Sync Call) Successfully received image description (length: {len(description)}).")
                return description
            except Exception as e:
                 logger.error(f"(Sync Call) Error during Together AI image description: {e}", exc_info=True)
                 raise # Re-raise

        try:
            # --- Wrap the sync call in run_in_threadpool ---
            logger.info("Dispatching synchronous get_image_description call to thread pool...")
            result = await run_in_threadpool(_sync_describe)
            logger.info("Received result from get_image_description thread pool task.")
            return result
        except Exception as e:
             # Handle errors raised within the threadpool function
             logger.error(f"Error executing get_image_description in thread pool: {e}", exc_info=True)
             if isinstance(e, ValueError):
                  raise HTTPException(status_code=500, detail=str(e))
             else:
                  raise HTTPException(status_code=502, detail=f"Failed background task for image description: {str(e)}")


# --- Singleton --- (Should use the synchronous client)
try:
    # Initialize the synchronous client if not done above
    if 'together_client' not in globals():
         together_client = together.Together(api_key=TOGETHER_API_KEY)
         logger.info("Synchronous Together AI client initialized for service.")

    together_service = TogetherService(client=together_client)
except Exception as e:
    logger.critical(f"Could not initialize Together Service. Error: {e}", exc_info=True)
    together_service = None