# backend/routers/chat.py
import uuid
from fastapi import APIRouter, HTTPException

router = APIRouter(
    prefix="/chat",  # All routes in this file will start with /chat
    tags=["Chat"],   # Tag for OpenAPI documentation
)

# In-memory store for active conversations (simple for prototype)
# In production, you might use Redis or a database
active_conversations = set()

@router.post("/conversation", response_model=dict)
async def create_conversation():
    """
    Generates a new unique conversation ID to track a chat session.
    """
    conversation_id = str(uuid.uuid4())
    active_conversations.add(conversation_id) # Add to our simple 'store'
    return {"conversation_id": conversation_id}

@router.get("/conversation/{conversation_id}", response_model=dict)
async def check_conversation(conversation_id: str):
    """
    Checks if a conversation ID is currently 'active' (exists in memory).
    """
    if conversation_id not in active_conversations:
        raise HTTPException(status_code=404, detail="Conversation ID not found or expired")
    return {"status": "active", "conversation_id": conversation_id}

# We will add the main POST /chat endpoint here later