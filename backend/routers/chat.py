# backend/routers/chat.py
import uuid
import logging
import datetime # For timestamps
from fastapi import APIRouter, HTTPException, Depends, Body, Query # Import FastAPI components
from fastapi.concurrency import run_in_threadpool # Import for wrapping sync DB calls
from pydantic import BaseModel, Field # For request body validation
from sqlalchemy.orm import Session # Import Session for DB operations

# Import DB models and session getter
from models import chat_models as db_models # Contains Conversation, Message classes
from models.database import get_db # Dependency function to get DB session

# Import Services and Helpers
from services.qdrant_service import qdrant_service as qdrant_svc_instance
from services.embedding_service import embedding_service as embed_svc_instance
from services.together_service import together_service as together_svc_instance
from qdrant_client.http.models import PointStruct, Filter, FieldCondition, MatchValue

# --- Dependency Getters (for services) ---
async def get_qdrant_service():
    if not qdrant_svc_instance:
        raise HTTPException(status_code=503, detail="Qdrant service is unavailable")
    return qdrant_svc_instance

async def get_embedding_service():
     if not embed_svc_instance:
          raise HTTPException(status_code=503, detail="Embedding service is unavailable")
     return embed_svc_instance

async def get_together_service():
    if not together_svc_instance:
        raise HTTPException(status_code=503, detail="Together AI service is unavailable")
    return together_svc_instance

# --- Logger ---
logger = logging.getLogger(__name__)

# --- API Router ---
router = APIRouter(
    prefix="/chat", 
    tags=["Chat & Conversations"]
    ) # Update tag


# --- New/Modified Pydantic Models ---
class ConversationInfo(BaseModel):
    id: str
    created_at: datetime.datetime # Pydantic V2 handles datetime serialization

    class Config:
        from_attributes = True # Use instead of orm_mode=True

class MessageInfo(BaseModel):
    id: str
    speaker: str
    text: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class ConversationDetail(ConversationInfo):
    messages: list[MessageInfo] = []

class ChatRequest(BaseModel):
    query: str
    conversation_id: str
    # kb_id: str | None = None # Add later for persistent KBs

class ChatResponse(BaseModel):
    response: str
    conversation_id: str
    sources: list[dict] # List of retrieved context sources

# --- Endpoint Implementations ---

@router.post("/conversations", response_model=ConversationInfo) # Changed endpoint name slightly
async def create_conversation(db: Session = Depends(get_db)): # Inject DB Session
    """
    Creates a new conversation record in the database and returns its ID.
    """
    conversation_id = str(uuid.uuid4())
    db_conversation = db_models.Conversation(id=conversation_id)
    def _sync_create():
        try:
            db.add(db_conversation)
            db.commit()
            db.refresh(db_conversation)
            return db_conversation # Return the object
        except Exception as e:
             db.rollback()
             logger.error(f"Failed to create conversation in DB: {e}", exc_info=True)
             raise Exception(f"Database error during conversation creation: {str(e)}") from e
    try:
        created_conv = await run_in_threadpool(_sync_create)
        logger.info(f"Created new conversation with ID: {created_conv.id}")
        return created_conv # FastAPI will convert using ConversationInfo model
    except Exception as e:
         raise HTTPException(status_code=500, detail=f"Failed to create conversation: {str(e)}")



@router.get("/conversations", response_model=list[ConversationInfo])
async def list_conversations(
    # Define as Query parameters with defaults
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0), # Default 0, must be >= 0
    limit: int = Query(10, ge=1, le=100) # Default 10, must be 1-100
):
    """Lists existing conversations, ordered by creation date descending."""
    def _sync_list():
        logger.info(f"DB Query: Fetching conversations with skip={skip}, limit={limit}") # Log params received
        return db.query(db_models.Conversation).order_by(db_models.Conversation.created_at.desc()).offset(skip).limit(limit).all()

    try:
        conversations = await run_in_threadpool(_sync_list)
        return conversations
    except Exception as e:
        logger.error(f"Error listing conversations (skip={skip}, limit={limit}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve conversations")


# Modified to get full details including messages
@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation_details(conversation_id: str, db: Session = Depends(get_db)):
    """Gets details and all messages for a specific conversation."""
    def _sync_get_details():
        # Use joinedload to efficiently fetch messages along with conversation
        # from sqlalchemy.orm import joinedload # Import if needed
        # return db.query(db_models.Conversation).options(joinedload(db_models.Conversation.messages)).filter(db_models.Conversation.id == conversation_id).first()
        # Simpler query first, relies on relationship loading (might be N+1 query issue later)
         conv = db.query(db_models.Conversation).filter(db_models.Conversation.id == conversation_id).first()
         if conv:
             # Explicitly load messages if not eager loaded (or access triggers load)
             # print(f"Messages loaded: {len(conv.messages)}") # Debug log
             return conv
         return None


    try:
        db_conversation = await run_in_threadpool(_sync_get_details)
        if not db_conversation:
            raise HTTPException(status_code=404, detail="Conversation ID not found")
        # Pydantic should handle the nested messages serialization via ConversationDetail model
        return db_conversation
    except HTTPException as http_exc:
         raise http_exc
    except Exception as e:
         logger.error(f"Error checking conversation {conversation_id} in DB: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail=f"Database error checking conversation: {str(e)}")

@router.post("/message", response_model=ChatResponse)
async def handle_chat_message(
    request: ChatRequest,
    db: Session = Depends(get_db), # Inject DB Session
    qdrant = Depends(get_qdrant_service),
    embed_svc = Depends(get_embedding_service),
    together_svc = Depends(get_together_service),
):
    """
    Handles incoming user chat messages, performs RAG, stores messages, and returns AI response.
    """
    conversation_id = request.conversation_id
    user_query = request.query

    # --- Outer Try/Except for the entire request handling ---
    try:
        # 1. Validate Conversation ID (Wrap DB Query)
        def _sync_find_conversation():
            return db.query(db_models.Conversation).filter(db_models.Conversation.id == conversation_id).first()

        db_conversation = await run_in_threadpool(_sync_find_conversation)
        if not db_conversation:
             raise HTTPException(status_code=404, detail=f"Conversation ID '{conversation_id}' not found.")

        logger.info(f"Received query for conversation {conversation_id}: '{user_query}'")
        # Use timezone-aware UTC time
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        user_message_id = str(uuid.uuid4())
        ai_message_id = str(uuid.uuid4())

        # 2. Embed User Query (Async - No change needed)
        logger.info("Embedding user query...")
        query_embedding = await embed_svc.get_embeddings(texts=[user_query])
        if not query_embedding or len(query_embedding) != 1:
             raise HTTPException(status_code=500, detail="Failed to embed user query.")
        query_vector = query_embedding[0]

        # 3. Prepare to Store User Message (DB Object + Qdrant Point)
        db_user_message = db_models.Message(
            id=user_message_id,
            conversation_id=conversation_id,
            speaker="user",
            text=user_query,
            # created_at is set by DB default
        )
        user_point = PointStruct(
            id=user_message_id, # Use the same ID as the DB record
            vector=query_vector,
            payload={"conversation_id": conversation_id, "speaker": "user", "text": user_query} # Keep text for retrieval
        )

        # Add user message to DB session (but don't commit yet)
        db.add(db_user_message)
        logger.info(f"Added user message to DB session (ID: {user_message_id})")

        # Store user message in Qdrant (Sync call within Qdrant client is usually okay, assuming internal handling or low volume)
        # If Qdrant calls become blocking under load, they might also need run_in_threadpool
        try:
            logger.info("Storing user message in Qdrant 'collection_chat_history'...")
            qdrant.add_points(collection_name="collection_chat_history", points=[user_point])
        except Exception as q_err:
            logger.error(f"Failed to store user message in Qdrant: {q_err}", exc_info=True)
            # Decide if this is fatal - maybe just log and continue? Or raise HTTP 500?
            # Let's raise for now to be safe during development.
            db.rollback() # Rollback the DB add if Qdrant fails here
            raise HTTPException(status_code=500, detail=f"Failed to store user message vector: {str(q_err)}")


        # 4. Search Relevant Context (Qdrant search - sync within client, usually okay)
        logger.info(f"Searching for relevant context in Qdrant for conversation {conversation_id}...")
        # Filter to only include messages from the same conversation
        conv_filter = Filter(
            must=[
                FieldCondition(key="conversation_id", match=MatchValue(value=conversation_id))
            ]
        )
        logger.info(f"Filter for conversation {conversation_id}: {conv_filter}")
        logger.info("Searching relevant chunks in 'collection_uploads'...")
        upload_search_results = qdrant.search_points(
            collection_name="collection_uploads",
            query_vector=query_vector,
            query_filter=conv_filter,
            limit=3 # Tune this limit
        )
        logger.info("Searching relevant turns in 'collection_chat_history'...")
        history_search_results = qdrant.search_points(
            collection_name="collection_chat_history",
            query_vector=query_vector,
            query_filter=conv_filter,
            limit=3 # Tune this limit
        )

        # 5. Combine and Format Context
        context_chunks = []
        sources_for_response = []
        logger.info("Processing search results...")

        # Process upload results
        logger.info(f"--- Examining {len(upload_search_results)} Upload Hits ---") # Log count again
        for i, hit in enumerate(upload_search_results):
            logger.info(f"  Upload Hit {i+1} Payload: {hit.payload}") # Log the payload
            logger.info(f"  Upload Hit {i+1} Score: {hit.score}")
            # Try accessing the text
            chunk_text = hit.payload.get("text") # Use .get() without default first
            if chunk_text: # Check if text is not None and not empty
                logger.info(f"    Got non-empty text for upload hit {i+1}. Appending.")
                source_file = hit.payload.get("source_filename", "N/A")
                context_chunks.append(f"Context from uploaded file '{source_file}':\n{chunk_text}")
                sources_for_response.append({ "type": "upload", "filename": source_file, "score": hit.score, "text": chunk_text[:200]+"..." })
            else:
                logger.warning(f"    Upload hit {i+1} payload did NOT contain valid 'text'. Payload was: {hit.payload}")

        # Process history results
        history_chunks_temp = []
        logger.info(f"--- Examining {len(history_search_results)} History Hits ---") # Log count again
        for i, hit in enumerate(history_search_results):
            logger.info(f"  History Hit {i+1} Payload: {hit.payload}") # Log the payload
            logger.info(f"  History Hit {i+1} ID: {hit.id}, Score: {hit.score}")
            if hit.id == user_message_id:
                logger.info("    Skipping current user message in history results.")
                continue
            # Try accessing the text
            text = hit.payload.get("text")
            if text: # Check if text is not None and not empty
                logger.info(f"    Got non-empty text for history hit {i+1}. Appending.")
                speaker = hit.payload.get("speaker", "unknown")
                history_chunks_temp.append(f"{speaker.capitalize()}: {text}")
            else:
                logger.warning(f"    History hit {i+1} payload did NOT contain valid 'text'. Payload was: {hit.payload}")

        # Combine, putting history first might be slightly better contextually
        context_chunks = history_chunks_temp + context_chunks
        context_string = "\n\n---\n\n".join(context_chunks)
        logger.info(f"Combined context string length: {len(context_string)}")
        if not context_string.strip():
            context_string = "No specific context found from previous messages or documents."


        # 6. Construct the LLM Prompt (Refine as needed)
        prompt = f"""You are CassaGPT, a helpful AI assistant.
Answer the user's query based ONLY on the provided context below. If the context does not contain the answer, say you cannot answer based on the provided information. Do not use external knowledge.

--- Context ---
{context_string}
--- End Context ---

User Query: {user_query}

Assistant Response:"""


        # 7. Call LLM (Async - No change needed as service handles sync call internally)
        logger.info("Generating AI response...")
        ai_response_text = await together_svc.generate_text(prompt=prompt)


        # 8. Prepare to Store AI Response (DB Object + Qdrant Point)
        db_ai_message = db_models.Message(
            id=ai_message_id,
            conversation_id=conversation_id,
            speaker="ai",
            text=ai_response_text,
            # created_at set by DB
        )
        ai_point = None # Initialize
        ai_vector = None
        try: # Embed AI response
            logger.info("Embedding AI response...")
            ai_embedding = await embed_svc.get_embeddings(texts=[ai_response_text])
            if ai_embedding: ai_vector = ai_embedding[0]
            else: logger.error("Failed to embed AI response (empty result).")
        except Exception as emb_err:
            logger.error(f"Failed to embed AI response: {emb_err}", exc_info=True)
            # Continue without embedding AI response for history search if embedding fails

        # Add AI message to DB session
        db.add(db_ai_message)
        logger.info(f"Added AI message to DB session (ID: {ai_message_id})")

        # Store AI response in Qdrant if embedding succeeded
        if ai_vector:
            ai_point = PointStruct(
                id=ai_message_id, # Use same ID as DB record
                vector=ai_vector,
                payload={"conversation_id": conversation_id, "speaker": "ai", "text": ai_response_text}
            )
            try:
                 logger.info("Storing AI response in Qdrant 'collection_chat_history'...")
                 qdrant.add_points(collection_name="collection_chat_history", points=[ai_point])
            except Exception as q_err_ai:
                 logger.error(f"Failed to store AI message in Qdrant: {q_err_ai}", exc_info=True)
                 # Log but don't fail the request just because history vector store failed

        # --- Commit all DB changes for this request (user msg + ai msg) ---
        def _sync_commit_messages():
            try:
                 db.commit()
                 logger.info("Committed DB session changes for user and AI messages.")
            except Exception as e:
                 db.rollback()
                 logger.error(f"DB Commit Error after processing chat message: {e}", exc_info=True)
                 # Re-raise to trigger outer error handling
                 raise Exception(f"Database commit error: {str(e)}") from e

        # Wrap the commit in threadpool
        await run_in_threadpool(_sync_commit_messages)

        # 9. Return Response to User
        logger.info(f"Sending AI response for conversation {conversation_id}.")
        return ChatResponse(
            response=ai_response_text,
            conversation_id=conversation_id,
            sources=sources_for_response # Include upload sources
        )

    # --- Outer Exception Handling ---
    except HTTPException as e:
         # Re-raise HTTPExceptions directly (e.g., 404 if conversation not found)
         # No rollback needed here as commit happens before this usually
         raise e
    except Exception as e:
         # Catch any other unexpected errors during the RAG process
         # Attempt rollback just in case something was added before commit failed/error occurred
         try:
             db.rollback()
             logger.info("Rolled back DB session due to unhandled error in chat handler.")
         except Exception as rb_err:
             logger.error(f"Error during rollback attempt in outer catch block: {rb_err}", exc_info=True)

         logger.error(f"Unhandled error during chat processing for conversation {conversation_id}: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail=f"An internal error occurred during chat processing: {str(e)}")
    
# --- Endpoint to get uploaded files for a conversation ---
class UploadedFileInfo(BaseModel):
     filename: str
     doc_id: str # The unique ID assigned during upload
     uploaded_at: datetime.datetime # Timestamp of upload

     class Config:
         from_attributes = True
         # from_attributes=True is used in Pydantic V2 to enable ORM-like behavior

# Placeholder - requires storing file info persistently or querying Qdrant efficiently
@router.get("/conversations/{conversation_id}/files", response_model=list[UploadedFileInfo])
async def list_uploaded_files(conversation_id: str, db: Session = Depends(get_db)):
    """
    Lists files uploaded specifically for this conversation from the database.
    """
    def _sync_get_files():
         logger.info(f"Querying DB for uploaded files for conversation {conversation_id}")
         return db.query(db_models.UploadedDocument)\
                  .filter(db_models.UploadedDocument.conversation_id == conversation_id)\
                  .order_by(db_models.UploadedDocument.uploaded_at.asc())\
                  .all()

    try:
        uploaded_docs = await run_in_threadpool(_sync_get_files)
        logger.info(f"Found {len(uploaded_docs)} uploaded file records for conversation {conversation_id}")
        # Pydantic will automatically convert the list of UploadedDocument objects
        # into the list[UploadedFileInfo] response structure
        return uploaded_docs
    except Exception as e:
         logger.error(f"Error fetching uploaded files for conversation {conversation_id}: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail="Failed to retrieve uploaded files")