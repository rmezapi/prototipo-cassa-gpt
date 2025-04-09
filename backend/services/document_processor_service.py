# backend/services/document_processor_service.py
import io
import logging
# import magic # Keep removed if using extensions
import pandas as pd # Keep pandas for now, might remove later if ONLY using csv conversion
from PIL import Image
from docx import Document as DocxDocument
from pypdf import PdfReader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from xlsx2csv import Xlsx2csv 
import cloudinary # Import cloudinary if needed here for type hints, maybe not
import cloudinary.uploader # Import uploader

# Import the together_service instance
from services.together_service import together_service, VISION_MODEL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    length_function=len,
    add_start_index=True,
)

class DocumentProcessorService:

    # Inject caption_service (now vision_service)
    def __init__(self, vision_service=together_service):
        self.vision_service = vision_service
        if not self.vision_service:
            logger.warning("Vision service not provided. Image processing will fail.")


    # --- Keep Text Extraction Methods for other types ---
    async def extract_text_from_pdf(self, file_bytes: bytes) -> str:
        # ... (implementation remains the same) ...
        text = ""
        try:
            reader = PdfReader(io.BytesIO(file_bytes))
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n" # Add newline between pages
            logger.info(f"Extracted {len(text)} characters from PDF.")
            return text
        except Exception as e:
            logger.error(f"Failed to extract text from PDF: {e}", exc_info=True)
            return "" # Return empty string on failure

    async def extract_text_from_docx(self, file_bytes: bytes) -> str:
        # ... (implementation remains the same) ...
        text = ""
        try:
            document = DocxDocument(io.BytesIO(file_bytes))
            for para in document.paragraphs:
                text += para.text + "\n"
            logger.info(f"Extracted {len(text)} characters from DOCX.")
            return text
        except Exception as e:
            logger.error(f"Failed to extract text from DOCX: {e}", exc_info=True)
            return ""

    # --- REMOVE or COMMENT OUT the old extract_text_from_xlsx ---
    # async def extract_text_from_xlsx(self, file_bytes: bytes) -> str:
    #    ... (old implementation) ...

    async def extract_text_from_image(self, image_url: str) -> str: # Accepts URL now
        """Generates a text description for an image using its Cloudinary URL."""
        if not self.vision_service:
            logger.error("Cannot process image: Vision service is not available.")
            return ""
        if not image_url:
            logger.error("Cannot process image: Image URL not provided.")
            return ""
        try:
            # Call the vision service with the URL
            description = await self.vision_service.get_image_description(
                image_url=image_url,
                model=VISION_MODEL # Ensure this model is correct
            )
            logger.info(f"Generated image description via URL: '{description[:100]}...'") # Log snippet
            # Prefix description for clarity in RAG context
            # Maybe add the URL too?
            return f"Image Description (Source: {image_url}):\n{description}"
        except Exception as e:
            # Error already logged in vision_service, just return empty
            logger.error(f"Failed during image description request: {e}")
            return ""

    # --- Helper to parse raw CSV string (can be simple) ---
    def _parse_csv_string(self, csv_string: str) -> str:
         """Parses a raw CSV string into a readable text format for RAG."""
         # Simple approach: Treat first line as header, subsequent lines as data
         # Adds Sheet context.
         lines = csv_string.strip().splitlines()
         if not lines:
             return ""

         text = "" # Initialize text
         header = lines[0]
         text += f"Headers: {header}\n"
         for i, line in enumerate(lines[1:]):
             # Simple joining, assumes comma delimiter. Using csv module would be more robust.
             text += f"Row {i+1}: {line}\n"
         text += "\n" # Add blank line after sheet data
         return text
    
    # Convert XLSX to CSV (all sheets concatenated)
    def convert_xlsx_to_csv(self, file_bytes: bytes, filename) -> str:
        #     """Converts XLSX file bytes to a CSV string."""   
        logger.info(f"Converting XLSX '{filename}' to CSV (all sheets concatenated)...")
        concatenated_csv_text = "" # Initialize final_text
        try:
            xlsx_file_obj = io.BytesIO(file_bytes)
            converter = Xlsx2csv(xlsx_file_obj, outputencoding="utf-8")
            csv_buffer = io.StringIO()
            converter.convert(csv_buffer, sheetid=0) # Convert all sheets to CSV , sheet_id=0 for all sheets
            csv_string = csv_buffer.getvalue()
            csv_buffer.close()
            if csv_string:
                # Parse the CSV string for this sheet and add context
                concatenated_csv_text += self._parse_csv_string(csv_string)
            else:
                logger.info(f"All sheets resulted in empty CSV output.")

            raw_text = concatenated_csv_text # Assign the combined text
            logger.info(f"Finished getting all sheets from {filename}.")
            return raw_text # Return the combined text

        except Exception as e:
                logger.error(f"Failed during XLSX to CSV conversion for {filename}: {e}", exc_info=True)
                return [] # Return empty list on conversion failure


    # --- Main Processing Method ---
    async def process_document(
            self, 
            file_bytes: bytes | None, # File bytes might be None if URL is provided directly
            filename: str,
            image_url: str | None # Optional image URL for image processing
            ) -> list[str]:
        """
        Identifies file type (extension), extracts text/caption (converts XLSX to CSV),
        and chunks the content. Returns a list of text chunks.
        """
        if not filename or '.' not in filename:
            logger.warning(f"Invalid filename '{filename}'. Cannot determine file type.")
            return []

        file_extension = filename.split('.')[-1].lower()
        logger.info(f"Processing file '{filename}' based on extension '{file_extension}'")

        raw_text = "" # Initialize raw_text

        # --- Type Handling ---
        if file_extension == 'pdf':
            raw_text = await self.extract_text_from_pdf(file_bytes)
        elif file_extension == 'docx':
            raw_text = await self.extract_text_from_docx(file_bytes)
        elif file_extension == 'csv':
            # Convert CSV bytes to string and parse it
            raw_text = file_bytes.decode('utf-8')
            parsed_text = self._parse_csv_string(raw_text)
            if parsed_text:
                raw_text = parsed_text
                logger.info(f"Parsed CSV content: {parsed_text[:100]}...")

        # --- MODIFIED XLSX Handling ---
        elif file_extension == 'xlsx':
            # Convert XLSX to CSV (all sheets concatenated)
            raw_text = self.convert_xlsx_to_csv(file_bytes, filename)
            if not raw_text:
                logger.warning(f"Could not extract text from XLSX file '{filename}'.")
                return []
        # --- END MODIFIED XLSX Handling ---

        elif file_extension in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']:
            # Use image_url if provided, otherwise log error
             if image_url:
                 raw_text = await self.extract_text_from_image(image_url)
             else:
                 logger.error(f"Cannot process image file '{filename}' without an image_url.")
                 return []
        elif file_bytes is None:
             # If not an image, we need file_bytes
             logger.error(f"File bytes are required for non-image file '{filename}'.")
             return []
        elif file_extension == 'txt':
             try:
                  raw_text = file_bytes.decode('utf-8')
                  logger.info(f"Read {len(raw_text)} characters from plain text file.")
             except UnicodeDecodeError:
                  logger.warning(f"Could not decode file {filename} as UTF-8 text.")
                  return []
        else:
            logger.warning(f"Unsupported file extension '{file_extension}' for file '{filename}'. Skipping.")
            return []

        # --- Chunking (Common step for all extracted text) ---
        if not raw_text.strip(): # Check if any text was actually extracted/generated
            logger.warning(f"No text content derived from {filename}. Skipping chunking.")
            return []

        logger.info(f"Chunking extracted text (total length: {len(raw_text)})...")
        chunks = text_splitter.split_text(raw_text)
        logger.info(f"Split text into {len(chunks)} chunks for file {filename}.")

        return chunks

# --- Singleton Pattern --- (remains the same)
doc_processor_service = DocumentProcessorService(vision_service=together_service)

