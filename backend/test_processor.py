# backend/test_processor.py
import asyncio
import os
import logging # Import logging
from dotenv import load_dotenv # Import dotenv

# --- Load environment variables ---
load_dotenv() # Make sure .env is loaded for Cloudinary keys etc.

# --- Import necessary services/modules ---
from services.document_processor_service import doc_processor_service

# Import Cloudinary if configured and check status
try:
    import cloudinary
    import cloudinary.uploader
    # Configure Cloudinary client (needs to happen before using it)
    CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME")
    CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY")
    CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET")

    if all([CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET]):
        cloudinary.config(
            cloud_name=CLOUDINARY_CLOUD_NAME,
            api_key=CLOUDINARY_API_KEY,
            api_secret=CLOUDINARY_API_SECRET,
            secure=True
        )
        CLOUDINARY_ENABLED = True
        logging.info("Cloudinary configured successfully for test script.")
    else:
        CLOUDINARY_ENABLED = False
        logging.warning("Cloudinary credentials missing. Cannot test Cloudinary upload.")
except ImportError:
    CLOUDINARY_ENABLED = False
    logging.warning("Cloudinary library not installed. Cannot test Cloudinary upload.")
except Exception as config_err:
     CLOUDINARY_ENABLED = False
     logging.error(f"Error configuring Cloudinary: {config_err}", exc_info=True)


# --- Configuration for Image Test ---
test_image_filename = "rm-logo-letter.jpg" # CHANGE THIS to your image file in test_docs
cloudinary_folder_name = "CassaGPT Prototipo/TestUploads" # Optional: Use a subfolder for tests

# --- End Configuration ---


async def main():
    # Construct the path to the local test image
    file_path = os.path.join('test_docs', test_image_filename)
    print(f"--- Testing Full Image Upload & Processing Flow ---")
    print(f"Local File: {file_path}")

    if not os.path.exists(file_path):
        print(f"ERROR: Test image file not found at '{file_path}'")
        return

    if not CLOUDINARY_ENABLED:
        print("ERROR: Cloudinary is not configured or enabled. Skipping Cloudinary upload test.")
        return

    uploaded_image_url = None
    try:
        # 1. Read the local image file bytes
        with open(file_path, 'rb') as f:
            image_bytes = f.read()
            if not image_bytes:
                 print(f"ERROR: Failed to read bytes from {file_path}")
                 return

        # 2. Upload to Cloudinary (Simulating the endpoint logic)
        print(f"\nUploading '{test_image_filename}' to Cloudinary folder '{cloudinary_folder_name}'...")
        upload_result = cloudinary.uploader.upload(
            image_bytes, # Pass the bytes directly
            folder=cloudinary_folder_name,
            resource_type="image"
            # Add public_id=... if you want specific naming
        )
        uploaded_image_url = upload_result.get('secure_url')

        if not uploaded_image_url:
            print("ERROR: Cloudinary upload succeeded but returned no URL.")
            print("Cloudinary Response:", upload_result)
            return

        print(f"Cloudinary Upload Successful!")
        print(f"Obtained URL: {uploaded_image_url}")

        # 3. Process Document using the obtained URL
        print(f"\nProcessing document using Cloudinary URL...")
        chunks = await doc_processor_service.process_document(
            filename=test_image_filename, # Pass the original filename
            file_bytes=None,             # Pass None for file_bytes (already uploaded)
            image_url=uploaded_image_url # Pass the REAL URL from Cloudinary
        )

        # 4. Display Results
        if chunks:
            print(f"\n--- Generated {len(chunks)} Chunks ---")
            for i, chunk in enumerate(chunks):
                print(f"\n--- Chunk {i+1} (Image Description) ---")
                print(chunk)
        else:
            print("\nNo chunks generated. Check logs for potential errors in description generation.")

    except cloudinary.exceptions.Error as cloud_err:
         print(f"\n--- Cloudinary Error ---")
         print(f"{type(cloud_err).__name__}: {cloud_err}")
         traceback.print_exc()
    except Exception as e:
        print(f"\n--- An unexpected error occurred ---")
        print(f"{type(e).__name__}: {e}")
        import traceback
        traceback.print_exc() # Print full traceback for debugging

if __name__ == "__main__":
    # Configure basic logging for the test script itself
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    asyncio.run(main())