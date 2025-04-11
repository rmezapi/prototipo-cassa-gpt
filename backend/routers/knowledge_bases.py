# backend/routers/knowledge_bases.py
import uuid
import logging
import datetime # Ensure datetime is imported
from fastapi import APIRouter, HTTPException, Depends, Body, Query, BackgroundTasks, File, UploadFile # Added Query, BackgroundTasks, File, UploadFile
from pydantic import BaseModel, Field # Use pydantic for request/response models
from sqlalchemy.orm import Session, joinedload # Added joinedload
from fastapi.concurrency import run_in_threadpool

# Import DB session and models
from models.database import get_db, SessionLocal as db_session_factory # Import session factory for background tasks
from models import chat_models as db_models # Contains KnowledgeBase model

# Import services needed for processing
from services.qdrant_service import qdrant_service as qdrant_svc_instance, QdrantService
from services.embedding_service import embedding_service as embed_svc_instance, EmbeddingService
from services.document_processor_service import doc_processor_service as processor_instance, DocumentProcessorService
from qdrant_client.http.models import PointStruct # For creating points


logger = logging.getLogger(__name__)

# --- Pydantic Models for API ---

class KnowledgeBaseCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Name for the new Knowledge Base")
    description: str | None = Field(None, max_length=500, description="Optional description for the KB")

class KnowledgeBaseInfo(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime.datetime # Pydantic V2 handles serialization

    class Config:
        from_attributes = True # Enable ORM mode / from_orm

# Model for Document Info
class KBDocumentInfo(BaseModel):
    id: str # DB row ID
    knowledge_base_id: str
    qdrant_doc_id: str # ID used in Qdrant payload
    filename: str
    status: str # e.g., "processing", "completed", "error"
    error_message: str | None
    uploaded_at: datetime.datetime

    class Config:
        from_attributes = True

# Model for KB Details (includes documents)
class KnowledgeBaseDetail(KnowledgeBaseInfo):
    # Allow documents list to be empty initially
    documents: list[KBDocumentInfo] = Field(default_factory=list)

# Model for Upload Response
class KBDocumentUploadResponse(BaseModel):
    processed_files: int
    failed_files: list[str] # List of filenames that failed
    details: list[KBDocumentInfo] # Details of successfully processed/attempted files


# --- API Router ---
router = APIRouter(
    prefix="/kbs", # Base path for all routes in this file
    tags=["Knowledge Bases"], # Tag for OpenAPI documentation
)

# --- Dependency Getters for Services (ensure they are defined) ---
async def get_qdrant_service():
    if not qdrant_svc_instance: raise HTTPException(503, "Qdrant service unavailable")
    return qdrant_svc_instance
async def get_embedding_service():
    if not embed_svc_instance: raise HTTPException(503, "Embedding service unavailable")
    return embed_svc_instance
async def get_doc_processor():
    if not processor_instance: raise HTTPException(503, "Doc processor unavailable")
    return processor_instance

# --- Endpoint Implementations ---

@router.post("", response_model=KnowledgeBaseInfo, status_code=201)
async def create_knowledge_base(
    kb_data: KnowledgeBaseCreateRequest,
    db: Session = Depends(get_db)
):
    logger.info(f"Received request to create Knowledge Base: Name='{kb_data.name}'")
    db_kb = db_models.KnowledgeBase(
        id=str(uuid.uuid4()),
        name=kb_data.name,
        description=kb_data.description
    )

    def _sync_create_kb():
        try:
            existing = db.query(db_models.KnowledgeBase.id).filter(db_models.KnowledgeBase.name == db_kb.name).first()
            if existing:
                 raise ValueError(f"Knowledge Base with name '{db_kb.name}' already exists.")

            logger.info(f"Attempting to add KB '{db_kb.name}' to DB session...")
            db.add(db_kb)
            logger.info("Attempting to commit...")
            db.commit()
            logger.info("Commit successful.")
            # --- REMOVE THIS LINE ---
            # db.refresh(db_kb)
            # --- END REMOVAL ---
            logger.info("Refresh skipped (not needed).")
            return db_kb # Return the object instance after commit
        except Exception as e:
             logger.error(f"Exception inside _sync_create_kb for '{db_kb.name}': {e}", exc_info=True)
             try: db.rollback(); logger.info("DB rollback successful.")
             except Exception as rb_err: logger.error(f"Error during rollback: {rb_err}", exc_info=True)
             raise # Re-raise the original error

    created_kb_result = None
    try:
        logger.info("Dispatching _sync_create_kb to threadpool...")
        created_kb_result = await run_in_threadpool(_sync_create_kb)
        logger.info("Threadpool execution finished.")

        if created_kb_result is None:
             logger.error("run_in_threadpool completed but returned None unexpectedly.")
             raise HTTPException(status_code=500, detail="Failed to create Knowledge Base: Internal processing error.")

        logger.info(f"Successfully created Knowledge Base with ID: {created_kb_result.id}")
        # Pydantic serialization will work correctly on the returned object
        return created_kb_result

    except ValueError as ve:
         logger.warning(f"Conflict creating KB: {ve}")
         raise HTTPException(status_code=409, detail=str(ve))
    except Exception as e:
         logger.error(f"Error caught after run_in_threadpool for create_knowledge_base: {e}", exc_info=True)
         if isinstance(e, HTTPException): raise e
         else: raise HTTPException(status_code=500, detail=f"Failed to create Knowledge Base: {str(e)}")
         

@router.get("", response_model=list[KnowledgeBaseInfo])
async def list_knowledge_bases(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0, description="Number of KBs to skip for pagination"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of KBs to return")
):
    """
    Lists existing Knowledge Bases, ordered by creation date descending.
    Supports pagination using 'skip' and 'limit' query parameters.
    """
    logger.info(f"Received request to list Knowledge Bases: skip={skip}, limit={limit}")

    def _sync_list_kbs():
        try:
            # Query the database
            return db.query(db_models.KnowledgeBase)\
                     .order_by(db_models.KnowledgeBase.created_at.desc())\
                     .offset(skip)\
                     .limit(limit)\
                     .all()
        except Exception as e:
            logger.error(f"Error querying Knowledge Bases from DB: {e}", exc_info=True)
            raise # Re-raise

    try:
        kbs = await run_in_threadpool(_sync_list_kbs)
        logger.info(f"Returning {len(kbs)} Knowledge Bases.")
        # Check if kbs is None before returning (though .all() should return [])
        if kbs is None:
             logger.error("DB query for list_knowledge_bases returned None unexpectedly.")
             return [] # Return empty list instead of None
        return kbs
    except Exception as e:
        logger.error(f"Error processing list_knowledge_bases request: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve Knowledge Bases: {str(e)}")


@router.get("/{kb_id}", response_model=KnowledgeBaseDetail)
async def get_knowledge_base_details(kb_id: str, db: Session = Depends(get_db)):
    """
    Retrieves details for a specific Knowledge Base, including its documents.
    """
    logger.info(f"Received request for details of KB ID: {kb_id}")

    def _sync_get_kb_details():
        kb = None
        try:
            # Use joinedload for efficiency if listing many documents often
            kb = db.query(db_models.KnowledgeBase)\
                   .options(joinedload(db_models.KnowledgeBase.documents))\
                   .filter(db_models.KnowledgeBase.id == kb_id)\
                   .first()
            return kb # Returns object or None
        except Exception as e:
            logger.error(f"DB error fetching details for KB {kb_id}: {e}", exc_info=True)
            raise Exception(f"DB error occurred: {str(e)}") from e # Ensure exception is raised

    try:
        db_kb = await run_in_threadpool(_sync_get_kb_details)
        if not db_kb:
            logger.warning(f"Knowledge Base with ID '{kb_id}' not found in DB.")
            raise HTTPException(status_code=404, detail=f"Knowledge Base with ID '{kb_id}' not found.")

        logger.info(f"Found KB '{db_kb.name}' with {len(db_kb.documents)} documents.")
        return db_kb # Pydantic converts using KnowledgeBaseDetail model
    except HTTPException as http_exc:
        raise http_exc # Re-raise 404 etc.
    except Exception as e:
        logger.error(f"Error processing get_knowledge_base_details for {kb_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve KB details: {str(e)}")


@router.get("/{kb_id}/documents", response_model=list[KBDocumentInfo])
async def list_kb_documents(
    kb_id: str,
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000)
):
    """
    Lists documents within a specific Knowledge Base. Supports pagination.
    """
    logger.info(f"Received request to list documents for KB ID: {kb_id}, skip={skip}, limit={limit}")

    def _sync_list_docs():
        docs = [] # Initialize to empty list
        try:
            # Check if KB exists first to provide a clear 404
            kb_exists = db.query(db_models.KnowledgeBase.id).filter(db_models.KnowledgeBase.id == kb_id).scalar() # Use scalar() for efficiency
            if not kb_exists:
                 raise ValueError("KB_NOT_FOUND")

            docs = db.query(db_models.KnowledgeBaseDocument)\
                     .filter(db_models.KnowledgeBaseDocument.knowledge_base_id == kb_id)\
                     .order_by(db_models.KnowledgeBaseDocument.uploaded_at.desc())\
                     .offset(skip)\
                     .limit(limit)\
                     .all()
            return docs # Returns list (possibly empty)
        except ValueError as ve: # Catch specific internal error
             if str(ve) == "KB_NOT_FOUND": raise
             else: logger.error(f"DB value error listing docs for KB {kb_id}: {ve}", exc_info=True); raise
        except Exception as e:
             logger.error(f"DB error listing documents for KB {kb_id}: {e}", exc_info=True)
             raise

    try:
        db_docs = await run_in_threadpool(_sync_list_docs)
        # No need to check for None, .all() returns [] if no results
        logger.info(f"Found {len(db_docs)} documents for KB ID: {kb_id}")
        return db_docs
    except ValueError as ve: # Handle KB_NOT_FOUND raised from sync function
         if str(ve) == "KB_NOT_FOUND":
              raise HTTPException(status_code=404, detail=f"Knowledge Base with ID '{kb_id}' not found.")
         else: raise HTTPException(status_code=500, detail=f"Error retrieving documents: {str(ve)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve documents: {str(e)}")


# --- Background Task Processing Function ---
async def process_kb_upload_task(
    db_session_factory, # Pass factory, not session
    kb_id: str,
    kb_doc_id: str, # DB row ID of the KnowledgeBaseDocument record
    qdrant_doc_id: str, # Unique ID for Qdrant chunks
    filename: str,
    file_content: bytes, # Content read from UploadFile
    qdrant: QdrantService, # Pass service instances
    processor: DocumentProcessorService,
    embed_svc: EmbeddingService
):
    """Processes a single uploaded file for a Knowledge Base in the background."""
    logger.info(f"BG Task: Processing '{filename}' for KB {kb_id}, DB Doc ID {kb_doc_id}, Qdrant Doc ID {qdrant_doc_id}")
    db: Session = db_session_factory() # Create new session
    status = "error"
    error_msg = None
    chunks_added = 0
    try:
        # 1. Process & Chunk
        logger.info(f"BG Task [{kb_doc_id}]: Chunking '{filename}'...")
        chunks = await processor.process_document(file_bytes=file_content, filename=filename, image_url=None)
        if not chunks:
            error_msg = "No processable content found or file type unsupported."
            logger.warning(f"BG Task [{kb_doc_id}]: {error_msg} for '{filename}'.")
        else:
            # 2. Embed Chunks
            logger.info(f"BG Task [{kb_doc_id}]: Embedding {len(chunks)} chunks...")
            embeddings = await embed_svc.get_embeddings(texts=chunks)
            if len(embeddings) != len(chunks):
                 error_msg = "Embedding count mismatch."
                 logger.error(f"BG Task [{kb_doc_id}]: {error_msg}")
            else:
                 # 3. Prepare Qdrant Points
                points_to_add = []
                for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                    point = PointStruct(id=str(uuid.uuid4()), vector=embedding, payload={"kb_id": kb_id, "doc_id": qdrant_doc_id, "filename": filename, "chunk_seq_num": i, "text": chunk})
                    points_to_add.append(point)
                 # 4. Add to Qdrant 'collection_kb'
                logger.info(f"BG Task [{kb_doc_id}]: Adding {len(points_to_add)} points to Qdrant...")
                qdrant.add_points(collection_name="collection_kb", points=points_to_add)
                chunks_added = len(points_to_add)
                status = "completed"
                logger.info(f"BG Task [{kb_doc_id}]: Added {chunks_added} chunks for '{filename}'.")
    except HTTPException as http_exc:
        logger.error(f"BG Task [{kb_doc_id}]: Service error processing '{filename}': {http_exc.detail}", exc_info=False) # Less verbose traceback
        error_msg = f"Service Error: {http_exc.detail}"
    except Exception as e:
        logger.error(f"BG Task [{kb_doc_id}]: Unexpected error processing '{filename}': {e}", exc_info=True)
        error_msg = f"Unexpected Error: {str(e)}"
        status = "error"
    finally: # Ensure DB update happens even if processing fails
        try:
            logger.info(f"BG Task [{kb_doc_id}]: Updating DB status to '{status}'...")
            db_doc = db.query(db_models.KnowledgeBaseDocument).filter(db_models.KnowledgeBaseDocument.id == kb_doc_id).first()
            if db_doc:
                db_doc.status = status
                db_doc.error_message = error_msg
                db.commit()
                logger.info(f"BG Task [{kb_doc_id}]: DB status update complete.")
            else:
                logger.error(f"BG Task [{kb_doc_id}]: CRITICAL - KBDocument record not found in DB to update status!")
        except Exception as db_update_err:
            db.rollback()
            logger.error(f"BG Task [{kb_doc_id}]: CRITICAL - Failed to update document status in DB: {db_update_err}", exc_info=True)
        finally:
            db.close() # Ensure session is closed


# --- Upload Endpoint ---
@router.post("/{kb_id}/documents/upload", response_model=KBDocumentUploadResponse, status_code=202)
async def upload_documents_to_kb(
    kb_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(..., description="Files to upload"),
    db: Session = Depends(get_db),
    qdrant: QdrantService = Depends(get_qdrant_service),
    processor: DocumentProcessorService = Depends(get_doc_processor),
    embed_svc: EmbeddingService = Depends(get_embedding_service),
):
    logger.info(f"Received request to upload {len(files)} files to KB ID: {kb_id}")

    # 1. Check if KB exists (sync helper)
    def _sync_check_kb(): return db.query(db_models.KnowledgeBase.id).filter(db_models.KnowledgeBase.id == kb_id).scalar()
    try:
        kb_exists = await run_in_threadpool(_sync_check_kb)
        if not kb_exists: raise HTTPException(status_code=404, detail=f"Knowledge Base ID '{kb_id}' not found.")
    except Exception as e: raise HTTPException(status_code=500, detail=f"DB error checking KB: {str(e)}")

    processed_count = 0
    failed_files_list = []
    processed_details = []

    # 2. Iterate, create DB record, add background task
    for file in files:
        if not file.filename: logger.warning("Skipping file with no filename."); failed_files_list.append("(Unnamed File)"); continue
        filename = file.filename
        logger.info(f"Preparing '{filename}' for background processing.")

        # Create DB record within the request scope transaction
        kb_doc_id = str(uuid.uuid4()) # DB row ID
        qdrant_doc_id = str(uuid.uuid4()) # Qdrant grouping ID
        db_kb_doc = db_models.KnowledgeBaseDocument(
            id=kb_doc_id, knowledge_base_id=kb_id, qdrant_doc_id=qdrant_doc_id,
            filename=filename, status="processing"
        )
        try:
            file_content = await file.read() # Read content before commit/task add
            db.add(db_kb_doc)
            db.flush() # Assign IDs and defaults but don't fully commit yet
            db.refresh(db_kb_doc) # Get updated values like uploaded_at
            logger.info(f"Added KBDocument record for '{filename}' (ID: {kb_doc_id}) to session.")

            background_tasks.add_task( # Add task *before* commit
                process_kb_upload_task,
                db_session_factory=db_session_factory, kb_id=kb_id, kb_doc_id=kb_doc_id,
                qdrant_doc_id=qdrant_doc_id, filename=filename, file_content=file_content,
                qdrant=qdrant, processor=processor, embed_svc=embed_svc
            )
            processed_count += 1
            processed_details.append(KBDocumentInfo.from_orm(db_kb_doc)) # Prepare response detail

        except Exception as err: # Catch read errors or initial DB errors
             # No db.rollback() needed here as commit hasn't happened for this file yet
             logger.error(f"Failed preparing task for '{filename}': {err}", exc_info=True)
             failed_files_list.append(filename)
             # Explicitly expire the object if added but not committed? Maybe not needed.
             if db_kb_doc in db: db.expire(db_kb_doc)

    # Commit all successfully added DB records at the end
    try:
        if processed_count > 0:
            db.commit()
            logger.info(f"Committed initial DB records for {processed_count} files.")
    except Exception as commit_err:
         db.rollback()
         logger.error(f"CRITICAL: Failed final commit for upload metadata: {commit_err}", exc_info=True)
         # This is tricky - tasks were added but records not saved. Need robust handling.
         # For now, return error indicating partial failure.
         raise HTTPException(status_code=500, detail="Failed to save upload metadata after queuing tasks.")


    logger.info(f"Finished request. Queued: {processed_count}, Failed Initial: {len(failed_files_list)}")
    # Return 202 Accepted
    return KBDocumentUploadResponse( processed_files=processed_count, failed_files=failed_files_list, details=processed_details )