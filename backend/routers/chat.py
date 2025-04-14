# backend/routers/chat.py
import uuid
import logging
import datetime
from typing import List, Optional # Import typing helpers
from fastapi import APIRouter, HTTPException, Depends, Body, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session, joinedload, selectinload # Import joinedload/selectinload

# Import DB models and session getter
from models import chat_models as db_models
from models.database import get_db

# Import Pydantic Schemas (ensure names match those defined in chat_models.py)
from models.chat_models import (
    ConversationInfoSchema,
    ConversationDetailSchema,
    ConversationCreatePayloadSchema,
    ChatRequestSchema,
    ChatResponseSchema,
    UploadedFileInfoSchema, # If using this in any endpoint response
    SourceInfoSchema # If using this
)

# Import Services and Helpers
from services.qdrant_service import QdrantService
from services.embedding_service import EmbeddingService
from services.together_service import TogetherService
from services.qdrant_service import qdrant_service as qdrant_svc_instance
from services.embedding_service import embedding_service as embed_svc_instance
from services.together_service import together_service as together_svc_instance
from qdrant_client.http.models import PointStruct, Filter, FieldCondition, MatchValue

# --- Dependency Getters ---
# (Keep existing get_qdrant_service, get_embedding_service, get_together_service functions)
async def get_qdrant_service() -> QdrantService:
    if not qdrant_svc_instance:
        raise HTTPException(status_code=503, detail="Qdrant service is unavailable")
    return qdrant_svc_instance

async def get_embedding_service() -> EmbeddingService:
     if not embed_svc_instance:
          raise HTTPException(status_code=503, detail="Embedding service is unavailable")
     return embed_svc_instance

async def get_together_service() -> TogetherService:
    if not together_svc_instance:
        raise HTTPException(status_code=503, detail="Together AI service is unavailable")
    return together_svc_instance

# --- Logger ---
logger = logging.getLogger(__name__)

# --- API Router ---
router = APIRouter(
    prefix="/chat",
    tags=["Chat & Conversations"]
)

# --- Endpoint Implementations ---

# --- Use specific schema names ---
@router.post("/conversations", response_model=ConversationInfoSchema) # Use specific schema
async def create_conversation(
    payload: Optional[ConversationCreatePayloadSchema] = Body(None), # Use specific schema
    db: Session = Depends(get_db)
):
    """
    Creates a new conversation record, optionally linking it to a Knowledge Base.
    """
    conversation_id = str(uuid.uuid4())
    kb_id_to_store = payload.knowledge_base_id if payload and payload.knowledge_base_id else None

    logger.info(f"Attempting to create conversation, linking KB ID: {kb_id_to_store}")

    if kb_id_to_store:
        def _sync_check_kb():
            return db.query(db_models.KnowledgeBase).filter(db_models.KnowledgeBase.id == kb_id_to_store).first()
        try:
            kb_record = await run_in_threadpool(_sync_check_kb)
            if not kb_record:
                logger.warning(f"KnowledgeBase ID '{kb_id_to_store}' provided but not found in DB. Conversation will not be linked.")
                kb_id_to_store = None
        except Exception as e:
            logger.error(f"Database error checking KnowledgeBase ID {kb_id_to_store}: {e}", exc_info=True)
            kb_id_to_store = None

    db_conversation = db_models.Conversation(
        id=conversation_id,
        knowledge_base_id=kb_id_to_store
    )

    def _sync_create():
        try:
            db.add(db_conversation)
            db.commit()
            db.refresh(db_conversation)
            return db_conversation
        except Exception as e:
             db.rollback()
             logger.error(f"Failed to create conversation in DB: {e}", exc_info=True)
             # Ensure detail is a string
             raise Exception(f"Database error during conversation creation: {str(e)}") from e
    try:
        created_conv = await run_in_threadpool(_sync_create)
        logger.info(f"Created new conversation with ID: {created_conv.id}, linked KB: {created_conv.knowledge_base_id}")
        return created_conv # Pydantic uses the response_model
    except Exception as e:
         # Ensure detail is a string
         raise HTTPException(status_code=500, detail=f"Failed to create conversation: {str(e)}")


@router.get("/conversations", response_model=List[ConversationInfoSchema]) # Use specific schema
async def list_conversations(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100) # Default limit 10
):
    """Lists existing conversations, ordered by creation date descending."""
    def _sync_list():
        logger.info(f"DB Query: Fetching conversations with skip={skip}, limit={limit}")
        # If you needed KB name in the list view, add joinedload here too
        # .options(joinedload(db_models.Conversation.knowledge_base))
        return db.query(db_models.Conversation)\
                 .order_by(db_models.Conversation.created_at.desc())\
                 .offset(skip)\
                 .limit(limit)\
                 .all()
    try:
        conversations = await run_in_threadpool(_sync_list)
        return conversations # Pydantic uses the response_model
    except Exception as e:
        logger.error(f"Error listing conversations (skip={skip}, limit={limit}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve conversations")


# --- MODIFIED: Use updated response_model and loading strategy ---
@router.get("/conversations/{conversation_id}", response_model=ConversationDetailSchema) # Use updated schema
async def get_conversation_details(conversation_id: str, db: Session = Depends(get_db)):
    """
    Gets details, messages, and linked KB info for a specific conversation.
    """
    def _sync_get_details():
        # Eagerly load messages AND the related knowledge_base object
        logger.info(f"DB Query: Fetching details for Conversation {conversation_id} with messages and KB.")
        conv = db.query(db_models.Conversation)\
                 .options(
                     selectinload(db_models.Conversation.messages), # Efficient loading for messages list
                     joinedload(db_models.Conversation.knowledge_base) # Load the single related KB object
                 )\
                 .filter(db_models.Conversation.id == conversation_id).first()

        if conv:
            # Debug log to check if KB object is loaded
            kb_name = conv.knowledge_base.name if conv.knowledge_base else "None"
            logger.info(f"DB Query Result: Found Conversation {conversation_id}. Linked KB Name: {kb_name}. Messages loaded: {len(conv.messages)}")
            return conv
        else:
            logger.info(f"DB Query Result: Conversation {conversation_id} not found.")
            return None

    try:
        db_conversation = await run_in_threadpool(_sync_get_details)
        if not db_conversation:
            logger.warning(f"Conversation {conversation_id} not found in DB.")
            raise HTTPException(status_code=404, detail="Conversation ID not found")

        # Pydantic uses the response_model (ConversationDetailSchema) to serialize
        # the db_conversation object, including the nested knowledge_base if it exists.
        return db_conversation
    except HTTPException as http_exc:
         # Re-raise HTTPExceptions (like 404) directly
         raise http_exc
    except Exception as e:
         logger.error(f"Error getting conversation details {conversation_id} from DB: {e}", exc_info=True)
         # Ensure detail is a string
         detail = f"Database error getting conversation details: {str(e)}"
         raise HTTPException(status_code=500, detail=detail)


@router.post("/message", response_model=ChatResponseSchema) # Use specific schema
async def handle_chat_message(
    request: ChatRequestSchema, # Use specific schema
    db: Session = Depends(get_db),
    qdrant: QdrantService = Depends(get_qdrant_service),
    embed_svc: EmbeddingService = Depends(get_embedding_service),
    together_svc: TogetherService = Depends(get_together_service),
):
    """
    Handles incoming user chat messages, performs RAG (including KB context),
    stores messages, and returns AI response.
    """
    conversation_id = request.conversation_id
    user_query = request.query

    try:
        # 1. Validate Conversation ID and Get Linked KB ID
        def _sync_find_conversation():
            # No need to load KB object here, just need the ID
            return db.query(db_models.Conversation.knowledge_base_id)\
                     .filter(db_models.Conversation.id == conversation_id).scalar() # Fetch only the ID efficiently

        # db_conversation = await run_in_threadpool(_sync_find_conversation) # This will now only return the kb_id or None
        kb_id = await run_in_threadpool(_sync_find_conversation)

        # Check if conversation exists by checking if kb_id is None or a string (a non-existent convo would raise exception below or return nothing)
        # A more robust check would be needed if the query could return None for an *existing* conversation without a KB
        # Let's re-fetch the conversation object to be sure it exists, or rely on FK constraints.
        # For simplicity, let's assume the query returning None means convo doesn't exist or check later.
        # We might need a separate check: `db.query(db_models.Conversation.id)...`

        # --- Re-check conversation existence ---
        def _sync_check_conv_exists():
            return db.query(db_models.Conversation.id).filter(db_models.Conversation.id == conversation_id).first() is not None

        exists = await run_in_threadpool(_sync_check_conv_exists)
        if not exists:
             raise HTTPException(status_code=404, detail=f"Conversation ID '{conversation_id}' not found.")
        # --- End re-check ---


        logger.info(f"Received query for conversation {conversation_id} (Linked KB ID: {kb_id}): '{user_query}'")

        # Timestamps, Message IDs
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        user_message_id = str(uuid.uuid4())
        ai_message_id = str(uuid.uuid4())

        # 2. Embed User Query
        # ... (embedding code remains the same) ...
        logger.info("Embedding user query...")
        query_embedding = await embed_svc.get_embeddings(texts=[user_query])
        if not query_embedding or len(query_embedding) != 1:
             raise HTTPException(status_code=500, detail="Failed to embed user query.")
        query_vector = query_embedding[0]


        # 3. Prepare User Message (DB + Qdrant History)
        # ... (user message prep remains the same) ...
        db_user_message = db_models.Message(
            id=user_message_id,
            conversation_id=conversation_id,
            speaker="user",
            text=user_query,
        )
        user_point = PointStruct(
            id=user_message_id,
            vector=query_vector,
            payload={"conversation_id": conversation_id, "speaker": "user", "text": user_query, "timestamp": timestamp}
        )
        db.add(db_user_message)
        logger.info(f"Added user message to DB session (ID: {user_message_id})")

        try:
            logger.info("Storing user message in Qdrant 'collection_chat_history'...")
            qdrant.add_points(collection_name="collection_chat_history", points=[user_point])
        except Exception as q_err:
            logger.error(f"Failed to store user message in Qdrant: {q_err}", exc_info=True)
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to store user message vector: {str(q_err)}")


        # 4. Search Relevant Context (KB -> Uploads -> History)
        # ... (search logic remains the same, uses kb_id retrieved earlier) ...
        logger.info(f"Searching for relevant context in Qdrant for conversation {conversation_id}...")
        search_limit_kb = 4
        search_limit_uploads = 3
        search_limit_history = 3

        kb_search_results = []
        upload_search_results = []
        history_search_results = []

        # Search KB (if kb_id is not None)
        if kb_id:
            logger.info(f"Searching 'collection_kb' for KB ID: {kb_id}...")
            kb_filter = Filter(
                must=[FieldCondition(key="kb_id", match=MatchValue(value=kb_id))]
            )
            try:
                kb_search_results = qdrant.search_points(
                    collection_name="collection_kb",
                    query_vector=query_vector,
                    query_filter=kb_filter,
                    limit=search_limit_kb
                )
                logger.info(f"Found {len(kb_search_results)} hits in collection_kb for KB {kb_id}")
            except Exception as kb_search_err:
                logger.error(f"Error searching collection_kb for KB {kb_id}: {kb_search_err}", exc_info=True)
        else:
            logger.info("No KB linked to this conversation, skipping KB search.")

        # Search Session Uploads
        # ... (session upload search logic) ...
        logger.info("Searching 'collection_uploads' for this conversation...")
        conv_filter_uploads = Filter(
            must=[FieldCondition(key="conversation_id", match=MatchValue(value=conversation_id))]
        )
        try:
            upload_search_results = qdrant.search_points(
                collection_name="collection_uploads",
                query_vector=query_vector,
                query_filter=conv_filter_uploads,
                limit=search_limit_uploads
            )
            logger.info(f"Found {len(upload_search_results)} hits in collection_uploads for conversation {conversation_id}")
        except Exception as upload_search_err:
             logger.error(f"Error searching collection_uploads for conversation {conversation_id}: {upload_search_err}", exc_info=True)

        # Search Chat History
        # ... (history search logic) ...
        logger.info("Searching 'collection_chat_history' for this conversation...")
        conv_filter_history = Filter(
            must=[FieldCondition(key="conversation_id", match=MatchValue(value=conversation_id))]
        )
        try:
            history_search_results = qdrant.search_points(
                collection_name="collection_chat_history",
                query_vector=query_vector,
                query_filter=conv_filter_history,
                limit=search_limit_history + 1
            )
            logger.info(f"Found {len(history_search_results)} hits in collection_chat_history for conversation {conversation_id}")
        except Exception as history_search_err:
             logger.error(f"Error searching collection_chat_history for conversation {conversation_id}: {history_search_err}", exc_info=True)

        # 5. Combine and Format Context (Priority: KB > Uploads > History)
        # ... (context combination logic remains the same, uses SourceInfoSchema) ...
        context_chunks = []
        sources_for_response: list[SourceInfoSchema] = [] # Use the specific schema
        processed_qdrant_ids = set()

        logger.info("Processing search results (KB > Uploads > History)...")

        # Process KB results
        for hit in kb_search_results:
             if hit.id in processed_qdrant_ids: continue
             chunk_text = hit.payload.get("text")
             if chunk_text:
                 source_file = hit.payload.get("source_filename", "N/A")
                 context_chunks.append(f"Context from Knowledge Base document '{source_file}':\n{chunk_text}")
                 sources_for_response.append(SourceInfoSchema( # Use specific schema
                     type="knowledge_base",
                     filename=source_file,
                     score=hit.score,
                     text=chunk_text[:200]+"..."
                 ))
                 processed_qdrant_ids.add(hit.id)

        # Process upload results
        for hit in upload_search_results:
             if hit.id in processed_qdrant_ids: continue
             chunk_text = hit.payload.get("text")
             if chunk_text:
                 source_file = hit.payload.get("source_filename", "N/A")
                 context_chunks.append(f"Context from session uploaded file '{source_file}':\n{chunk_text}")
                 sources_for_response.append(SourceInfoSchema( # Use specific schema
                     type="session_upload",
                     filename=source_file,
                     score=hit.score,
                     text=chunk_text[:200]+"..."
                 ))
                 processed_qdrant_ids.add(hit.id)

        # Process history results
        history_chunks_temp = []
        for hit in history_search_results:
             if hit.id in processed_qdrant_ids or hit.id == user_message_id: continue
             text = hit.payload.get("text")
             if text:
                 speaker = hit.payload.get("speaker", "unknown")
                 history_chunks_temp.append(f"{speaker.capitalize()}: {text}")
                 processed_qdrant_ids.add(hit.id)

        # Combine
        context_chunks.extend(history_chunks_temp)
        context_string = "\n\n---\n\n".join(context_chunks)
        logger.info(f"Combined context string length: {len(context_string)}")
        if not context_string.strip():
             context_string = "No specific context found from knowledge base, previous messages or session documents."


        # 6. Construct the LLM Prompt
        # ... (prompt construction remains the same) ...
        prompt = f"""You are CassaGPT, a helpful AI assistant.
Answer the user's query based ONLY on the provided context below. If the context does not contain the answer, state that you cannot answer based on the provided information. Do not use external knowledge. Be concise.

--- Context ---
{context_string}
--- End Context ---

User Query: {user_query}

Assistant Response:"""


        # 7. Call LLM
        # ... (LLM call remains the same) ...
        logger.info("Generating AI response...")
        ai_response_text = await together_svc.generate_text(prompt=prompt)


        # 8. Prepare AI Response (DB + Qdrant History)
        # ... (AI response prep remains the same) ...
        db_ai_message = db_models.Message(
            id=ai_message_id,
            conversation_id=conversation_id,
            speaker="ai",
            text=ai_response_text,
        )
        db.add(db_ai_message)
        logger.info(f"Added AI message to DB session (ID: {ai_message_id})")

        ai_point = None
        try:
            logger.info("Embedding AI response...")
            ai_embedding = await embed_svc.get_embeddings(texts=[ai_response_text])
            if ai_embedding:
                ai_vector = ai_embedding[0]
                ai_point = PointStruct(
                    id=ai_message_id,
                    vector=ai_vector,
                    payload={"conversation_id": conversation_id, "speaker": "ai", "text": ai_response_text, "timestamp": timestamp}
                )
                logger.info("Storing AI response in Qdrant 'collection_chat_history'...")
                qdrant.add_points(collection_name="collection_chat_history", points=[ai_point])
            else:
                logger.error("Failed to embed AI response (empty result).")
        except Exception as ai_store_err:
             logger.error(f"Failed to embed or store AI message in Qdrant: {ai_store_err}", exc_info=True)


        # --- Commit DB changes (user msg + ai msg) ---
        # ... (commit logic remains the same) ...
        def _sync_commit_messages():
            try:
                 db.commit()
                 logger.info("Committed DB session changes for user and AI messages.")
            except Exception as e:
                 db.rollback()
                 logger.error(f"DB Commit Error after processing chat message: {e}", exc_info=True)
                 # Ensure detail is a string
                 raise Exception(f"Database commit error: {str(e)}") from e
        await run_in_threadpool(_sync_commit_messages)


        # 9. Return Response to User
        logger.info(f"Sending AI response for conversation {conversation_id}.")
        return ChatResponseSchema( # Use specific schema
            response=ai_response_text,
            conversation_id=conversation_id,
            sources=sources_for_response
        )

    except HTTPException as e:
         raise e
    except Exception as e:
         try: db.rollback()
         except Exception as rb_err: logger.error(f"Error during rollback: {rb_err}", exc_info=True)
         logger.error(f"Unhandled error during chat processing for conversation {conversation_id}: {e}", exc_info=True)
         # Ensure detail is a string
         raise HTTPException(status_code=500, detail=f"An internal error occurred during chat processing: {str(e)}")


@router.get("/conversations/{conversation_id}/files", response_model=List[UploadedFileInfoSchema]) # Use specific schema
async def list_uploaded_files(conversation_id: str, db: Session = Depends(get_db)):
    """
    Lists files uploaded specifically for this conversation session.
    """
    def _sync_get_files():
         logger.info(f"Querying DB for session uploaded files for conversation {conversation_id}")
         return db.query(db_models.UploadedDocument)\
                  .filter(db_models.UploadedDocument.conversation_id == conversation_id)\
                  .order_by(db_models.UploadedDocument.uploaded_at.asc())\
                  .all()
    try:
        uploaded_docs = await run_in_threadpool(_sync_get_files)
        logger.info(f"Found {len(uploaded_docs)} session uploaded file records for conversation {conversation_id}")
        return uploaded_docs # Pydantic uses the response_model
    except Exception as e:
         logger.error(f"Error fetching session uploaded files for conversation {conversation_id}: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail="Failed to retrieve session uploaded files")