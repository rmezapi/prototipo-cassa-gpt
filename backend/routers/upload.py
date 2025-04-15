# backend/routers/upload.py
import uuid
import logging
from fastapi import APIRouter, HTTPException, File, UploadFile, Form, Depends
from qdrant_client.http.models import PointStruct
# import datetime # Not explicitly needed if using DB defaults
from sqlalchemy.orm import Session
from models import chat_models as db_models
from models.database import get_db
from fastapi.concurrency import run_in_threadpool

# --- Import Services ---
# Import Qdrant Service and its dependency getter
from services.qdrant_service import qdrant_service as qdrant_svc_instance # Rename for clarity
async def get_qdrant_service():
    if not qdrant_svc_instance:
        raise HTTPException(status_code=503, detail="Qdrant service is unavailable")
    return qdrant_svc_instance

# Import Document Processor Service and its dependency getter
from services.document_processor_service import doc_processor_service as processor_instance
async def get_doc_processor():
     if not processor_instance:
          raise HTTPException(status_code=503, detail="Document processing service unavailable")
     return processor_instance

# --- Import NEW Embedding Service and its dependency getter ---
from services.embedding_service import embedding_service as embed_svc_instance
async def get_embedding_service():
     if not embed_svc_instance:
          raise HTTPException(status_code=503, detail="Embedding service is unavailable")
     return embed_svc_instance

# Import Cloudinary (keep this check)
try:
    import cloudinary
    import cloudinary.uploader
    CLOUDINARY_ENABLED = True
except ImportError:
    CLOUDINARY_ENABLED = False

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/upload",
    tags=["Upload & Indexing (Session)"], # Clarified tag
)

@router.post("", status_code=201)
async def upload_and_process_session_file( # Renamed function for clarity
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
    conversation_id: str = Form(...),
    qdrant = Depends(get_qdrant_service),
    processor = Depends(get_doc_processor),
    embed_svc = Depends(get_embedding_service),
):
    """
    Handles SESSION uploads. Uploads file, processes (incl. images via Cloudinary),
    embeds, stores chunks in Qdrant 'collection_uploads', saves metadata
    to 'uploaded_documents' table, and adds a generic system message.
    """
    logger.info(f"Received SESSION file upload for conversation_id: {conversation_id}")
    if not file.filename:
         raise HTTPException(status_code=400, detail="Filename cannot be empty")
    filename = file.filename
    logger.info(f"Processing session file: {filename}")

    contents = await file.read()
    image_url_for_processing = None
    file_bytes_for_processing = None

    file_extension = filename.split('.')[-1].lower() if '.' in filename else ''
    is_image = file_extension in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']

    # --- Cloudinary Upload with Folder ---
    if is_image:
        if not CLOUDINARY_ENABLED:
             logger.error("Received session image but Cloudinary integration is not enabled/configured.")
             raise HTTPException(status_code=501, detail="Image uploads require Cloudinary configuration.")
        logger.info(f"Uploading session image '{filename}' to Cloudinary...")
        try:
            # Use a generic folder or one specific to session uploads
            upload_result = cloudinary.uploader.upload(
                contents,
                folder="CassaGPT_Session_Uploads", # Example folder
                resource_type="image"
            )
            image_url_for_processing = upload_result.get('secure_url')
            if not image_url_for_processing:
                 raise HTTPException(status_code=500, detail="Cloudinary upload succeeded but returned no URL.")
            logger.info(f"Cloudinary session upload successful. URL: {image_url_for_processing}")
        except Exception as e:
            logger.error(f"Cloudinary upload failed for {filename}: {e}", exc_info=True)
            raise HTTPException(status_code=502, detail=f"Failed to upload image to Cloudinary: {str(e)}")
        # Don't pass bytes for image if URL exists
        file_bytes_for_processing = None
    else:
        file_bytes_for_processing = contents

    # --- Process Document ---
    try:
        logger.info(f"Processing session document '{filename}'...")
        chunks = await processor.process_document( # Uses injected processor instance
            filename=filename,
            file_bytes=file_bytes_for_processing,
            image_url=image_url_for_processing # Pass URL for images, bytes otherwise
        )
    except Exception as e:
        logger.error(f"Failed processing session document {filename}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing document: {str(e)}")

    if not chunks:
        logger.warning(f"No chunks generated for session file {filename}.")
        # Consider returning a more specific response structure if needed
        return {"message": "File received but no processable content found or generated.", "filename": filename, "chunks_added": 0}

    # --- Generate Embeddings using NEW Service ---
    try:
        logger.info(f"Generating embeddings for {len(chunks)} chunks from session file '{filename}'...")
        embeddings = await embed_svc.get_embeddings(texts=chunks)
        if len(embeddings) != len(chunks):
             raise HTTPException(status_code=500, detail="Mismatch between number of chunks and embeddings received.")
        logger.info(f"Successfully generated {len(embeddings)} embeddings.")
    except HTTPException as e:
         # Re-raise HTTPExceptions from the service
         raise e
    except Exception as e:
        logger.error(f"Embedding generation failed for {filename}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Failed to generate embeddings: {str(e)}")

    # --- Prepare Points for Qdrant 'collection_uploads' ---
    session_doc_id = str(uuid.uuid4()) # Unique ID for this specific session document upload
    points_to_add = []
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        point = PointStruct(
            id=str(uuid.uuid4()), # Unique ID for each chunk/point
            vector=embedding,
            payload={
                "doc_id": session_doc_id, # Link chunks together for this upload
                "source_filename": filename,
                "chunk_seq_num": i,
                "text": chunk,
                "conversation_id": conversation_id, # Link to the conversation
            }
        )
        points_to_add.append(point)

    # --- Add Points to Qdrant ---
    try:
        logger.info(f"Adding {len(points_to_add)} points to Qdrant collection 'collection_uploads'...")
        qdrant.add_points( # Uses injected qdrant service instance
            collection_name="collection_uploads",
            points=points_to_add
        )
        logger.info(f"Successfully added points to Qdrant collection 'collection_uploads' for {filename}.")
    except HTTPException as e:
         # Re-raise HTTPExceptions from the service
         raise e
    except Exception as e:
        logger.error(f"Failed to add points to Qdrant for {filename}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to store document chunks: {str(e)}")

    # --- Store metadata in 'uploaded_documents' table & generic system message ---
    system_message_text = f"Processed session file: {filename}" # Generic message
    system_message_id = str(uuid.uuid4())

    db_uploaded_doc = db_models.UploadedDocument(
        conversation_id=conversation_id,
        doc_id=session_doc_id, # Store the unique session doc ID
        filename=filename,
        # uploaded_at handled by default in model
    )
    db_system_message = db_models.Message(
        id=system_message_id,
        conversation_id=conversation_id,
        speaker="system", # Mark as system message
        text=system_message_text,
        # *** DO NOT SET related_doc_id for session uploads ***
        # related_doc_id=session_doc_id # This caused the FK violation
        # created_at handled by default in model
    )

    def _sync_db_save_upload_meta():
        try:
            logger.info(f"Adding session upload metadata (doc_id: {session_doc_id}) and system message to DB.")
            db.add(db_uploaded_doc)
            db.add(db_system_message) # Add message without the incorrect FK
            db.commit()
            logger.info("DB commit successful for session upload metadata and system message.")
            # No refresh needed unless returning the created objects' details
        except Exception as db_err:
            db.rollback()
            logger.error(f"Failed to save session upload metadata/message to DB: {db_err}", exc_info=True)
            # Re-raise the exception to be caught by the main handler
            raise Exception(f"DB Error saving session upload metadata: {str(db_err)}") from db_err

    try:
         await run_in_threadpool(_sync_db_save_upload_meta)
         logger.info("Successfully saved session upload metadata and system message to DB.")
    except Exception as e:
         # If DB save fails, return a 500 indicating partial failure
         # The specific error is already logged
         raise HTTPException(status_code=500, detail=f"File indexed in vector store, but failed to save metadata to DB: {str(e)}")

    # Return success response
    return {
        "message": "Session file processed and indexed successfully.",
        "filename": filename,
        "doc_id": session_doc_id, # Return the session-specific doc_id
        "chunks_added": len(points_to_add)
    }