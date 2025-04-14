# backend/routers/knowledge_bases.py
import uuid
import logging
import datetime
import os # Added
import tempfile # Added
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, Body, Query, BackgroundTasks, File, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload
from fastapi.concurrency import run_in_threadpool # Import run_in_threadpool if needed for sync calls

# --- Cloudinary ---
# Import and configure Cloudinary here as well, as the background task needs it.
# Ensure configuration is loaded reliably (e.g., via main.py or dotenv)
import cloudinary
import cloudinary.uploader
import cloudinary.api
from dotenv import load_dotenv
load_dotenv() # Load .env file from backend directory

# Setup logger first
logging.basicConfig(level=logging.INFO) # Configure root logger if not done elsewhere
logger = logging.getLogger(__name__) # Get logger for this module

try:
    # Ensure environment variables are loaded before this
    cloudinary_cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    cloudinary_api_key = os.getenv("CLOUDINARY_API_KEY")
    cloudinary_api_secret = os.getenv("CLOUDINARY_API_SECRET")

    if not all([cloudinary_cloud_name, cloudinary_api_key, cloudinary_api_secret]):
        raise ValueError("Missing one or more Cloudinary environment variables (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)")

    cloudinary.config(
        cloud_name=cloudinary_cloud_name,
        api_key=cloudinary_api_key,
        api_secret=cloudinary_api_secret,
        secure=True
    )
    CLOUDINARY_BG_ENABLED = True
    logger.info("Cloudinary configured successfully for KB router/tasks.")
    # Optional verification ping
    # cloudinary.api.ping()
except Exception as config_err:
    CLOUDINARY_BG_ENABLED = False
    logger.error(f"Failed to configure Cloudinary in KB router: {config_err}. Image uploads in BG tasks will fail.", exc_info=True)
# --- End Cloudinary ---


# Import DB session and models
from models.database import get_db, SessionLocal as db_session_factory
from models import chat_models as db_models

# Import services
from services.qdrant_service import qdrant_service as qdrant_svc_instance, QdrantService
from services.embedding_service import embedding_service as embed_svc_instance, EmbeddingService
from services.document_processor_service import doc_processor_service as processor_instance, DocumentProcessorService, text_splitter # Import text_splitter if defined there
# *** IMPORT Together Service ***
from services.together_service import together_service as together_svc_instance, TogetherService, VISION_MODEL # Import service instance and model name

from qdrant_client.http.models import PointStruct

# --- Pydantic Models DEFINED LOCALLY ---

class KnowledgeBaseCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Name for the new Knowledge Base")
    description: str | None = Field(None, max_length=500, description="Optional description for the KB")

class KnowledgeBaseInfo(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class KBDocumentInfo(BaseModel):
    id: str
    knowledge_base_id: str
    qdrant_doc_id: str
    filename: str
    status: str
    error_message: str | None
    uploaded_at: datetime.datetime

    class Config:
        from_attributes = True

class KnowledgeBaseDetail(KnowledgeBaseInfo):
    documents: list[KBDocumentInfo] = Field(default_factory=list)

class KBDocumentUploadResponse(BaseModel):
    processed_files: int
    failed_files: list[str]
    details: list[KBDocumentInfo] # Details of successfully initiated file

# --- END Pydantic Models ---


# --- API Router ---
router = APIRouter(
    prefix="/kbs",
    tags=["Knowledge Bases"],
)

# --- Dependency Getters ---
async def get_qdrant_service():
    if not qdrant_svc_instance: raise HTTPException(503, "Qdrant service unavailable")
    return qdrant_svc_instance
async def get_embedding_service():
    if not embed_svc_instance: raise HTTPException(503, "Embedding service unavailable")
    return embed_svc_instance
async def get_doc_processor():
    if not processor_instance: raise HTTPException(503, "Doc processor unavailable")
    return processor_instance
# *** ADD Together Service Dependency Getter ***
async def get_together_service():
    if not together_svc_instance: raise HTTPException(503, "Together AI service unavailable")
    return together_svc_instance

# --- Background Task Processing Function ---
async def process_kb_upload_task(
    db_session_factory,
    kb_id: str,
    kb_doc_id: str,
    qdrant_doc_id: str,
    filename: str,
    file_content: bytes,
    qdrant: QdrantService,
    processor: DocumentProcessorService, # Still needed for non-images
    embed_svc: EmbeddingService,
    # *** ADD together_svc dependency ***
    together_svc: TogetherService
):
    """
    Processes a single uploaded file for a KB in the background.
    Handles image upload to Cloudinary and gets description via Together Vision API.
    (Version 4 with detailed logging)
    """
    logger.info(f"BG Task (v4): START Processing '{filename}' for KB {kb_id}, DB Doc ID {kb_doc_id}")
    db: Session = db_session_factory()
    status = "error" # Default to error
    error_msg = "Processing did not complete successfully." # Default error message
    chunks_to_embed = []

    try:
        file_extension = filename.split('.')[-1].lower() if '.' in filename else ''
        is_image = file_extension in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
        logger.info(f"BG Task [{kb_doc_id}]: Detected file type: {'Image' if is_image else 'Non-Image'}")

        if is_image:
            # --- IMAGE PROCESSING PATH ---
            logger.info(f"BG Task [{kb_doc_id}]: Entering image processing path.")
            if not CLOUDINARY_BG_ENABLED:
                 error_msg = "Image detected, but Cloudinary is not configured/enabled."
                 logger.error(f"BG Task [{kb_doc_id}]: {error_msg}")
                 # Jump directly to finally block if Cloudinary is not enabled
                 raise RuntimeError(error_msg) # Raise to go directly to finally
            else:
                image_url = None; temp_file_path = None
                # 1. Upload Image to Cloudinary
                try:
                    # Create temp file for upload
                    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_extension}") as temp_file:
                        temp_file.write(file_content); temp_file_path = temp_file.name
                    logger.info(f"BG Task [{kb_doc_id}]: Uploading image '{filename}' from path '{temp_file_path}'...")
                    upload_result = cloudinary.uploader.upload(temp_file_path, folder="CassaGPT_KB_Uploads", resource_type="image")
                    image_url = upload_result.get('secure_url')
                    if not image_url:
                        error_msg = "Cloudinary upload failed (no URL returned)."
                        logger.error(f"BG Task [{kb_doc_id}]: {error_msg} Result: {upload_result}")
                        raise RuntimeError(error_msg) # Raise to go to finally
                    else:
                         logger.info(f"BG Task [{kb_doc_id}]: Cloudinary OK. URL: {image_url}")
                except Exception as upload_err:
                    error_msg = f"Cloudinary upload exception: {str(upload_err)}"
                    logger.error(f"BG Task [{kb_doc_id}]: {error_msg}", exc_info=True)
                    raise RuntimeError(error_msg) # Raise to go to finally
                finally: # Temp file cleanup
                     if temp_file_path and os.path.exists(temp_file_path):
                         try: os.remove(temp_file_path)
                         except Exception as rm_err: logger.warning(f"Could not remove temp file '{temp_file_path}': {rm_err}")

                # 2. Get Description from Together AI (only if Cloudinary succeeded)
                # This part only runs if image_url was set and no exception was raised above
                logger.info(f"BG Task [{kb_doc_id}]: Checking Together AI service instance...")
                if not together_svc: # Check if the service object is valid
                     error_msg = "Together AI service instance is invalid/None in background task."
                     logger.error(f"BG Task [{kb_doc_id}]: {error_msg}")
                     raise RuntimeError(error_msg) # Go to finally

                description = None
                try:
                    logger.info(f"BG Task [{kb_doc_id}]: >>> BEFORE calling await together_svc.get_image_description")
                    # --- Call directly as the service method uses run_in_threadpool internally ---
                    description = await together_svc.get_image_description(image_url=image_url, model=VISION_MODEL)
                    # --- END ---
                    logger.info(f"BG Task [{kb_doc_id}]: <<< AFTER calling await together_svc.get_image_description. Received: '{str(description)[:100]}'")

                    if description and description.strip():
                        description_text = f"Image Filename: {filename}\nImage Description (Source: {image_url}):\n{description}"
                        logger.info(f"BG Task [{kb_doc_id}]: Description valid, attempting to chunk...")
                        # Use the imported text_splitter instance
                        chunks_to_embed = text_splitter.split_text(description_text)
                        if not chunks_to_embed: # Check if chunking produced results
                            error_msg = "Text splitter produced no chunks from description."
                            logger.warning(f"BG Task [{kb_doc_id}]: {error_msg}")
                        else:
                            logger.info(f"BG Task [{kb_doc_id}]: Chunked description into {len(chunks_to_embed)} chunks.")
                            error_msg = None # Clear default error message ONLY if chunking succeeds
                    else:
                        error_msg = "Vision API returned empty or invalid description."
                        logger.warning(f"BG Task [{kb_doc_id}]: {error_msg}")
                except Exception as vision_err:
                     error_msg = f"Error during Vision API call/processing: {str(vision_err)}"
                     logger.error(f"BG Task [{kb_doc_id}]: {error_msg}", exc_info=True)
                     # No raise here, error_msg is set, will proceed to finally block after try
            # --- END IMAGE PROCESSING PATH ---

        else:
            # --- NON-IMAGE PROCESSING PATH ---
            logger.info(f"BG Task [{kb_doc_id}]: Processing non-image file with DocumentProcessorService...")
            try:
                chunks_to_embed = await processor.process_document(
                    filename=filename,
                    file_bytes=file_content,
                    image_url=None # No URL needed here
                )
                if not chunks_to_embed:
                    error_msg = "Document processor returned no content for non-image file."
                    logger.warning(f"BG Task [{kb_doc_id}]: {error_msg}")
                else:
                    logger.info(f"BG Task [{kb_doc_id}]: Document processor returned {len(chunks_to_embed)} chunks.")
                    error_msg = None # Clear default error message if processing succeeded
            except Exception as proc_err:
                error_msg = f"Error during document processing: {str(proc_err)}"
                logger.error(f"BG Task [{kb_doc_id}]: {error_msg}", exc_info=True)
            # --- END NON-IMAGE PROCESSING PATH ---


        # --- Embed and Store (Common logic) ---
        if chunks_to_embed and error_msg is None: # Proceed only if chunks exist AND no prior error occurred
            logger.info(f"BG Task [{kb_doc_id}]: Proceeding to embedding/storage.")
            try:
                logger.info(f"BG Task [{kb_doc_id}]: Embedding {len(chunks_to_embed)} chunks...")
                embeddings = await embed_svc.get_embeddings(texts=chunks_to_embed)
                if len(embeddings) != len(chunks_to_embed):
                    error_msg = "Embedding count mismatch."
                    status = "error"
                    logger.error(f"BG Task [{kb_doc_id}]: {error_msg}")
                else:
                    points = [PointStruct(id=str(uuid.uuid4()), vector=emb, payload={"kb_id": kb_id, "doc_id": qdrant_doc_id, "filename": filename, "chunk_seq_num": i, "text": chunk}) for i, (chunk, emb) in enumerate(zip(chunks_to_embed, embeddings))]
                    logger.info(f"BG Task [{kb_doc_id}]: Adding {len(points)} points to Qdrant collection 'collection_kb'...")
                    qdrant.add_points(collection_name="collection_kb", points=points)
                    status = "completed" # Mark as completed ONLY if embedding/storage succeeds
                    error_msg = None # Clear error message on full success
                    logger.info(f"BG Task [{kb_doc_id}]: Successfully added {len(points)} points. Final Status: {status}")
            except Exception as embed_store_err:
                error_msg = f"Embedding/Storage failed: {str(embed_store_err)}"
                logger.error(f"BG Task [{kb_doc_id}]: {error_msg}", exc_info=True)
                status = "error"
        elif error_msg is None and not chunks_to_embed:
             # If processing yielded no chunks and no error was logged before
             error_msg = "No processable content found or generated." # Set the specific message
             logger.warning(f"BG Task [{kb_doc_id}]: Setting final error message: {error_msg}")
             status = "error" # Mark as error if no chunks
        # If error_msg was set previously, status remains 'error'

    except RuntimeError as rte: # Catch errors raised explicitly to jump to finally
        logger.warning(f"BG Task [{kb_doc_id}]: Caught runtime error, proceeding to finally block: {rte}")
        # error_msg should already be set from where it was raised
        if error_msg is None: error_msg = str(rte) # Fallback message
        status = "error" # Ensure status is error
    except Exception as e:
        logger.error(f"BG Task [{kb_doc_id}]: Unexpected top-level error in task: {e}", exc_info=True)
        error_msg = f"Unexpected Task Error: {str(e)}" # Overwrite default message
        status = "error"
    finally:
        # --- DB Status Update ---
        try:
            # Ensure error_msg has a value if status is 'error'
            if status == "error" and error_msg is None:
                error_msg = "An unspecified error occurred during processing."
                logger.warning(f"BG Task [{kb_doc_id}]: Status is error but no specific message was set. Using default.")

            logger.info(f"BG Task [{kb_doc_id}]: Finalizing DB status to '{status}' with message: '{error_msg}'")
            db_doc = db.query(db_models.KnowledgeBaseDocument).filter(db_models.KnowledgeBaseDocument.id == kb_doc_id).first()
            if db_doc:
                db_doc.status = status
                db_doc.error_message = error_msg # Assign the final message
                db.commit()
                logger.info(f"BG Task [{kb_doc_id}]: DB status update committed.")
            else:
                logger.error(f"BG Task [{kb_doc_id}]: CRITICAL - KBDocument record not found!")
        except Exception as db_err:
            db.rollback()
            logger.error(f"BG Task [{kb_doc_id}]: CRITICAL - Failed DB update: {db_err}", exc_info=True)
        finally:
            db.close() # Ensure session is closed
    logger.info(f"BG Task (v4): END Processing '{filename}'. Final Status: {status}")


# --- Upload Endpoint ---
@router.post("/{kb_id}/documents/upload", response_model=KBDocumentUploadResponse, status_code=202)
async def upload_kb_document(
    kb_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="The document file to upload"),
    db: Session = Depends(get_db),
    qdrant: QdrantService = Depends(get_qdrant_service),
    processor: DocumentProcessorService = Depends(get_doc_processor),
    embed_svc: EmbeddingService = Depends(get_embedding_service),
    # *** INJECT Together Service dependency ***
    together_svc: TogetherService = Depends(get_together_service),
):
    """
    Accepts a single document file, creates a database record,
    and queues background processing (chunking, embedding, Qdrant storage).
    Handles image description generation in the background task.
    """
    logger.info(f"Received request to upload file to KB ID: {kb_id}")
    # Check KB exists
    def _sync_check_kb(): return db.query(db_models.KnowledgeBase.id).filter(db_models.KnowledgeBase.id == kb_id).scalar()
    try:
        if not await run_in_threadpool(_sync_check_kb): raise HTTPException(404, f"KB ID '{kb_id}' not found.")
    except Exception as e: raise HTTPException(500, f"DB error checking KB: {str(e)}")

    processed_count = 0; failed_files_list = []; processed_details = []

    if not file.filename: failed_files_list.append("(Unnamed File)")
    else:
        filename = file.filename; logger.info(f"Preparing '{filename}' for background processing.")
        kb_doc_id = str(uuid.uuid4()); qdrant_doc_id = str(uuid.uuid4())
        db_kb_doc = db_models.KnowledgeBaseDocument(id=kb_doc_id, knowledge_base_id=kb_id, qdrant_doc_id=qdrant_doc_id, filename=filename, status="processing")
        try:
            file_content = await file.read();
            if not file_content: raise ValueError("File content is empty.")
            db.add(db_kb_doc); db.flush(); db.refresh(db_kb_doc);
            logger.info(f"Added KBDocument record for '{filename}' (ID: {kb_doc_id}) to session.")
            # Pass all necessary services to the background task
            background_tasks.add_task(
                process_kb_upload_task,
                db_session_factory=db_session_factory, kb_id=kb_id, kb_doc_id=kb_doc_id,
                qdrant_doc_id=qdrant_doc_id, filename=filename, file_content=file_content,
                qdrant=qdrant, processor=processor, embed_svc=embed_svc,
                together_svc=together_svc # Pass the vision service
            )
            processed_count = 1; processed_details.append(KBDocumentInfo.from_orm(db_kb_doc))
        except Exception as err: logger.error(f"Failed prep task for '{filename}': {err}", exc_info=True); failed_files_list.append(filename); db.expire(db_kb_doc) # Expire if added but error occurred

    # Commit DB record
    try:
        if processed_count > 0: db.commit(); logger.info(f"Committed DB record for {processed_count} file.")
        else: logger.warning("No file processed, nothing committed.")
    except Exception as commit_err: db.rollback(); logger.error(f"CRITICAL: Failed commit: {commit_err}", exc_info=True); raise HTTPException(500, "Failed save metadata.")

    logger.info(f"Finished request. Queued: {processed_count}, Failed Initial: {len(failed_files_list)}")
    return KBDocumentUploadResponse(processed_files=processed_count, failed_files=failed_files_list, details=processed_details)


# --- Other Endpoints ---

@router.post("", response_model=KnowledgeBaseInfo, status_code=201)
async def create_knowledge_base(
    kb_data: KnowledgeBaseCreateRequest,
    db: Session = Depends(get_db)
):
    logger.info(f"Received request to create Knowledge Base: Name='{kb_data.name}'")
    db_kb = db_models.KnowledgeBase(id=str(uuid.uuid4()), name=kb_data.name, description=kb_data.description)
    def _sync_create_kb():
        try:
            if db.query(db_models.KnowledgeBase.id).filter(db_models.KnowledgeBase.name == db_kb.name).first():
                 raise ValueError(f"KB name '{db_kb.name}' already exists.")
            db.add(db_kb); db.commit();
            return db_kb
        except Exception as e: db.rollback(); raise
    try:
        created_kb = await run_in_threadpool(_sync_create_kb)
        if not created_kb: raise HTTPException(500, "Failed creation: internal processing error.")
        logger.info(f"Successfully created KB ID: {created_kb.id}")
        return created_kb
    except ValueError as ve: raise HTTPException(409, str(ve))
    except Exception as e: raise HTTPException(500, f"Failed creation: {str(e)}")

@router.get("", response_model=list[KnowledgeBaseInfo])
async def list_knowledge_bases(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000)
):
    logger.info(f"Received request to list KBs: skip={skip}, limit={limit}")
    def _sync_list_kbs(): return db.query(db_models.KnowledgeBase).order_by(db_models.KnowledgeBase.created_at.desc()).offset(skip).limit(limit).all()
    try: return await run_in_threadpool(_sync_list_kbs) or []
    except Exception as e: raise HTTPException(500, f"Failed list KBs: {str(e)}")

@router.get("/{kb_id}", response_model=KnowledgeBaseDetail)
async def get_knowledge_base_details(
    kb_id: str,
    db: Session = Depends(get_db)
):
    logger.info(f"Received request for details of KB ID: {kb_id}")
    def _sync_get_kb_details(): return db.query(db_models.KnowledgeBase).options(joinedload(db_models.KnowledgeBase.documents)).filter(db_models.KnowledgeBase.id == kb_id).first()
    try:
        db_kb = await run_in_threadpool(_sync_get_kb_details)
        if not db_kb: raise HTTPException(404, f"KB ID '{kb_id}' not found.")
        logger.info(f"Found KB '{db_kb.name}' with {len(db_kb.documents)} documents.")
        return db_kb
    except HTTPException as he: raise he
    except Exception as e: raise HTTPException(500, f"Failed get KB details: {str(e)}")

@router.get("/{kb_id}/documents", response_model=list[KBDocumentInfo])
async def list_kb_documents(
    kb_id: str,
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000)
):
    logger.info(f"Received request list docs for KB: {kb_id}, skip={skip}, limit={limit}")
    def _sync_list_docs():
        if not db.query(db_models.KnowledgeBase.id).filter(db_models.KnowledgeBase.id == kb_id).scalar(): raise ValueError("KB_NOT_FOUND")
        return db.query(db_models.KnowledgeBaseDocument).filter(db_models.KnowledgeBaseDocument.knowledge_base_id == kb_id).order_by(db_models.KnowledgeBaseDocument.uploaded_at.desc()).offset(skip).limit(limit).all()
    try: return await run_in_threadpool(_sync_list_docs) or []
    except ValueError as ve: raise HTTPException(404, f"KB ID '{kb_id}' not found.")
    except Exception as e: raise HTTPException(500, f"Failed list docs: {str(e)}")