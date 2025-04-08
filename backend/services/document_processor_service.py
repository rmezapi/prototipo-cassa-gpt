# backend/services/document_processor_service.py
import io
import logging
# import magic # <--- REMOVE THIS IMPORT
import pandas as pd
from PIL import Image
from docx import Document as DocxDocument
from pypdf import PdfReader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from services.together_service import together_service, IMAGE_CAPTION_MODEL

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    length_function=len,
    add_start_index=True,
)

class DocumentProcessorService:

    def __init__(self, caption_service=together_service):
        self.caption_service = caption_service
        if not self.caption_service:
            logger.warning("Caption service not provided. Image processing will fail.")

    # REMOVE the _identify_mime_type method entirely

    # Keep extract_text_from_pdf, _docx, _xlsx, _image methods as they are

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
            # Consider extracting text from tables as well if needed
            # for table in document.tables:
            #     for row in table.rows:
            #         for cell in row.cells:
            #             text += cell.text + "\t" # Example separator
            #         text += "\n"
            logger.info(f"Extracted {len(text)} characters from DOCX.")
            return text
        except Exception as e:
            logger.error(f"Failed to extract text from DOCX: {e}", exc_info=True)
            return ""

    async def extract_text_from_xlsx(self, file_bytes: bytes) -> str:
        # ... (implementation remains the same) ...
        text = ""
        try:
            # Read all sheets into a dictionary of DataFrames
            excel_file = pd.ExcelFile(io.BytesIO(file_bytes))
            for sheet_name in excel_file.sheet_names:
                df = excel_file.parse(sheet_name)
                # Convert DataFrame to string representation (consider options)
                # Option 1: Simple string conversion
                # text += f"--- Sheet: {sheet_name} ---\n"
                # text += df.to_string(index=False, na_rep='NA') + "\n\n"

                # Option 2: Row-by-row string conversion (might be better for RAG)
                text += f"--- Sheet: {sheet_name} ---\n"
                for index, row in df.iterrows():
                     row_text = ", ".join([f"{col}: {val}" for col, val in row.astype(str).items()])
                     text += f"Row {index + 1}: {row_text}\n"
                text += "\n"

            logger.info(f"Extracted {len(text)} characters from XLSX.")
            return text
        except Exception as e:
            logger.error(f"Failed to extract text from XLSX: {e}", exc_info=True)
            return ""


    async def extract_text_from_image(self, file_bytes: bytes) -> str:
        # ... (implementation remains the same) ...
        if not self.caption_service:
            logger.error("Cannot process image: Caption service is not available.")
            return ""
        try:
            # Optional: Basic validation using Pillow
            try:
                 img = Image.open(io.BytesIO(file_bytes))
                 logger.info(f"Processing image of format {img.format}, size {img.size}")
            except Exception as img_err:
                 logger.error(f"Invalid image file provided: {img_err}")
                 return "" # Not a valid image

            # Call the caption service (e.g., TogetherService)
            caption = await self.caption_service.get_image_caption(
                image_bytes=file_bytes,
                model=IMAGE_CAPTION_MODEL # Ensure this model is correct
            )
            logger.info(f"Generated image caption: '{caption}'")
            # Prefix caption for clarity in RAG context
            return f"Image Description: {caption}"
        except Exception as e:
            # Error already logged in caption_service, just return empty
            logger.error(f"Failed during image captioning request: {e}")
            return ""


    async def process_document(self, file_bytes: bytes, filename: str) -> list[str]:
        """
        Identifies file type BASED ON EXTENSION, extracts text/caption, and chunks the content.
        Returns a list of text chunks.
        """
        # --- MODIFIED SECTION ---
        if not filename or '.' not in filename:
            logger.warning(f"Invalid filename '{filename}'. Cannot determine file type.")
            return []

        file_extension = filename.split('.')[-1].lower()
        logger.info(f"Processing file '{filename}' based on extension '{file_extension}'")

        raw_text = ""
        # Extract Text based on extension
        if file_extension == 'pdf':
            raw_text = await self.extract_text_from_pdf(file_bytes)
        elif file_extension == 'docx':
            raw_text = await self.extract_text_from_docx(file_bytes)
        elif file_extension == 'xlsx':
            raw_text = await self.extract_text_from_xlsx(file_bytes)
        elif file_extension in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']:
            raw_text = await self.extract_text_from_image(file_bytes)
        elif file_extension == 'txt': # Added basic text file support
             try:
                  raw_text = file_bytes.decode('utf-8')
                  logger.info(f"Read {len(raw_text)} characters from plain text file.")
             except UnicodeDecodeError:
                  logger.warning(f"Could not decode file {filename} as UTF-8 text.")
                  return []
        else:
            logger.warning(f"Unsupported file extension '{file_extension}' for file '{filename}'. Skipping.")
            return [] # Return empty list if unsupported extension
        # --- END MODIFIED SECTION ---

        # Chunk the Text (remains the same)
        if not raw_text:
            logger.warning(f"No text extracted from {filename}. Skipping chunking.")
            return []

        logger.info(f"Chunking extracted text (length: {len(raw_text)})...")
        chunks = text_splitter.split_text(raw_text)
        logger.info(f"Split text into {len(chunks)} chunks.")

        return chunks

# --- Singleton Pattern --- (remains the same)
doc_processor_service = DocumentProcessorService(caption_service=together_service)

# Add asyncio import if needed for mock sleep
import asyncio