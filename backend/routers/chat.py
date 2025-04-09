# backend/routers/chat.py
import uuid
import logging
import datetime # For timestamps
from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel # For request body validation
from sqlalchemy.orm import Session # Import Session

# Import DB models and session getter
from models import chat_models as db_models
from models.database import get_db, engine # Import engine if needed later for direct connection if SessionLocal fails
from models import database # Needed to ensure Base is configured before use maybes

# --- Import Services and Helpers ---
from services.qdrant_service import qdrant_service as qdrant_svc_instance
from services.embedding_service import embedding_service as embed_svc_instance, EXPECTED_EMBEDDING_DIMENSION
from services.together_service import together_service as together_svc_instance
from qdrant_client.http.models import PointStruct, Filter, FieldCondition, MatchValue

# --- Dependency Getters (ensure these exist or copy from upload.py) ---
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

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/chat",
    tags=["Chat"],
)

# --- Request/Response Models (using Pydantic) ---
class ChatRequest(BaseModel):
    query: str
    conversation_id: str
    # kb_id: str | None = None # Add later for persistent KBs

class ChatResponse(BaseModel):
    response: str
    conversation_id: str
    sources: list[dict] # List of retrieved context sources


# --- Modified Endpoints ---
@router.post("/conversation", response_model=dict)
async def create_conversation(db: Session = Depends(get_db)): # Inject DB Session
    """
    Creates a new conversation record in the database and returns its ID.
    """
    conversation_id = str(uuid.uuid4())
    db_conversation = db_models.Conversation(id=conversation_id)
    try:
        db.add(db_conversation)
        db.commit()
        db.refresh(db_conversation)
        logger.info(f"Created new conversation with ID: {conversation_id}")
        return {"conversation_id": conversation_id}
    except Exception as e:
         db.rollback()
         logger.error(f"Failed to create conversation in DB: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail="Failed to create conversation")

@router.get("/conversation/{conversation_id}", response_model=dict)
async def check_conversation(conversation_id: str, db: Session = Depends(get_db)): # Inject DB Session
    """
    Checks if a conversation ID exists in the database.
    """
    db_conversation = db.query(db_models.Conversation).filter(db_models.Conversation.id == conversation_id).first()
    if not db_conversation:
        raise HTTPException(status_code=404, detail="Conversation ID not found")
    # Return creation time or other info if needed
    return {"status": "exists", "conversation_id": conversation_id, "created_at": db_conversation.created_at}

@router.post("", response_model=ChatResponse)
async def handle_chat_message(
    request: ChatRequest,
    db: Session = Depends(get_db), # Inject DB Session
    qdrant = Depends(get_qdrant_service),
    embed_svc = Depends(get_embedding_service),
    together_svc = Depends(get_together_service),
):
    conversation_id = request.conversation_id
    user_query = request.query

    # 1. Validate Conversation ID from DB
    db_conversation = db.query(db_models.Conversation).filter(db_models.Conversation.id == conversation_id).first()
    if not db_conversation:
         raise HTTPException(status_code=404, detail=f"Conversation ID '{conversation_id}' not found.")

    logger.info(f"Received query for conversation {conversation_id}: '{user_query}'")
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat() # Use ISO format string
    user_message_id = str(uuid.uuid4())
    ai_message_id = str(uuid.uuid4())

    try:
        # 2. Embed User Query (No change)
        logger.info("Embedding user query...")
        query_embedding = await embed_svc.get_embeddings(texts=[user_query]) # No change
        query_vector = query_embedding[0]

        # 3. Store User Message in DB *AND* Qdrant History
        # DB Storage:
        db_user_message = db_models.Message(
            id=user_message_id,
            conversation_id=conversation_id,
            speaker="user",
            text=user_query,
            # created_at is set by default in DB
        )
        db.add(db_user_message)
        # Qdrant Storage (Payload doesn't need timestamp if it's in DB):
        user_point = PointStruct(
            id=user_message_id, # Use the same ID as the DB record
            vector=query_vector,
            payload={"conversation_id": conversation_id, "speaker": "user", "text": user_query}
        )
        logger.info("Storing user message in Qdrant 'collection_chat_history'...")
        qdrant.add_points(collection_name="collection_chat_history", points=[user_point])
        db.commit() # Commit *after* potentially error-prone Qdrant call? Or before? Decide consistency needs. Let's commit after Qdrant.
        logger.info(f"Stored user message in DB (ID: {user_message_id})")


        # 4. Search Context (No change in logic)
        conv_filter = Filter(...) # ... (filter logic remains same)
        logger.info("Searching relevant chunks in 'collection_uploads'...")
        upload_search_results = qdrant.search_points(...) # ... (search logic remains same)
        logger.info("Searching relevant turns in 'collection_chat_history'...")
        history_search_results = qdrant.search_points(...) # ... (search logic remains same)


        # 5. Combine Context (No change in logic)
        context_chunks = []
        sources_for_response = []
        # ... (processing search results remains same) ...
        context_string = "\n\n---\n\n".join(context_chunks)
        if not context_string.strip(): context_string = "No specific context found..."


        # 6. Construct Prompt (No change)
        prompt = f"""...{context_string}...User Query: {user_query}...Assistant Response:"""


        # 7. Call LLM (No change)
        logger.info("Generating AI response...")
        ai_response_text = await together_svc.generate_text(prompt=prompt)


        # 8. Store AI Response in DB *AND* Qdrant History
        # DB Storage:
        db_ai_message = db_models.Message(
            id=ai_message_id,
            conversation_id=conversation_id,
            speaker="ai",
            text=ai_response_text,
        )
        db.add(db_ai_message)
        # Qdrant Storage:
        logger.info("Embedding AI response...")
        ai_embedding = await embed_svc.get_embeddings(texts=[ai_response_text])
        if not ai_embedding:
             logger.error("Failed to embed AI response. Skipping Qdrant history storage for AI.")
             # Still commit the DB message below
        else:
            ai_vector = ai_embedding[0]
            ai_point = PointStruct(
                id=ai_message_id, # Use same ID as DB record
                vector=ai_vector,
                payload={"conversation_id": conversation_id, "speaker": "ai", "text": ai_response_text}
            )
            logger.info("Storing AI response in Qdrant 'collection_chat_history'...")
            qdrant.add_points(collection_name="collection_chat_history", points=[ai_point])

        db.commit() # Commit DB changes for user msg + AI msg
        logger.info(f"Stored AI message in DB (ID: {ai_message_id})")


        # 9. Return Response (No change)
        logger.info(f"Sending AI response for conversation {conversation_id}.")
        return ChatResponse(...) # ... (response construction remains same)

    except HTTPException as e:
         db.rollback() # Rollback DB changes on handled errors
         raise e
    except Exception as e:
         db.rollback() # Rollback DB changes on unhandled errors
         logger.error(f"Unhandled error during chat processing for conversation {conversation_id}: {e}", exc_info=True)
         raise HTTPException(status_code=500, detail=f"An internal error occurred: {str(e)}")