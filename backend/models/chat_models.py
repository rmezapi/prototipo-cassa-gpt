# backend/models/chat_models.py
import uuid
import datetime
from typing import List, Optional # Import List and Optional
from pydantic import BaseModel, Field # Import Pydantic components
from sqlalchemy import Column, String, DateTime, Text, ForeignKey # Removed Enum as not used
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base # Import Base from database.py

# --- SQLAlchemy Models (Database Tables) ---

class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(String, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    knowledge_base_id = Column(String, ForeignKey("knowledge_bases.id"), nullable=True, index=True)
    model_id = Column(String, nullable=True, index=True, default="meta-llama/Llama-3.3-70B-Instruct-Turbo-Free")

    # Relationships
    knowledge_base = relationship("KnowledgeBase", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan", lazy="selectin")
    uploaded_documents = relationship("UploadedDocument", back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, index=True)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    speaker = Column(String, nullable=False) # 'user', 'ai', 'system'
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    related_doc_id = Column(String, ForeignKey("knowledge_base_documents.qdrant_doc_id"), nullable=True, index=True)

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")


class UploadedDocument(Base): # Session uploads
    __tablename__ = "uploaded_documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    doc_id = Column(String, nullable=False, index=True)
    filename = Column(String, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    conversation = relationship("Conversation", back_populates="uploaded_documents")


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    conversations = relationship("Conversation", back_populates="knowledge_base")
    documents = relationship("KnowledgeBaseDocument", back_populates="knowledge_base", cascade="all, delete-orphan")


class KnowledgeBaseDocument(Base):
    __tablename__ = "knowledge_base_documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    knowledge_base_id = Column(String, ForeignKey("knowledge_bases.id"), nullable=False, index=True)
    qdrant_doc_id = Column(String, nullable=False, unique=True, index=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String, nullable=False)
    status = Column(String, nullable=False, default="processing", index=True) # "processing", "completed", "error"
    error_message = Column(Text, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    knowledge_base = relationship("KnowledgeBase", back_populates="documents")


# --- Pydantic Schemas (API Data Transfer Objects) ---

# Base schema for KB info (used nested)
class KnowledgeBaseInfoSchema(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime.datetime

    class Config:
        from_attributes = True

# Schema for individual message info
class MessageInfoSchema(BaseModel):
    id: str
    speaker: str # Consider Enum('user', 'ai', 'system') if needed
    text: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True

# Schema for session uploaded document info
class UploadedFileInfoSchema(BaseModel):
    id: str
    filename: str
    doc_id: str
    uploaded_at: datetime.datetime

    class Config:
        from_attributes = True

# Main schema for Conversation Details endpoint response
class ConversationDetailSchema(BaseModel):
    id: str
    created_at: datetime.datetime
    messages: List[MessageInfoSchema] = []
    knowledge_base_id: Optional[str] = None # ID of the linked KB
    knowledge_base: Optional[KnowledgeBaseInfoSchema] = Field(None, description="Details of the linked Knowledge Base, if any") # Nested KB details
    model_id: Optional[str] = "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free"
    # Optionally include session uploads if needed in this view
    # uploaded_documents: List[UploadedFileInfoSchema] = []

    class Config:
        from_attributes = True # Enable ORM mode compatibility

# Basic schema for Conversation list endpoint
class ConversationInfoSchema(BaseModel):
    id: str
    created_at: datetime.datetime
    knowledge_base_id: Optional[str] = None
    model_id: Optional[str] = "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free"
    # Optionally add knowledge_base name here too if needed for list view
    # knowledge_base_name: Optional[str] = None

    class Config:
        from_attributes = True

# Schema for creating a conversation
class ConversationCreatePayloadSchema(BaseModel):
    knowledge_base_id: Optional[str] = Field(None, description="Optional ID of the Knowledge Base to link to this conversation.")
    model_id: str = Field("meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", description="Model ID to use for this conversation.")

# Schema for chat request payload
class ChatRequestSchema(BaseModel):
    query: str
    conversation_id: str

# Schema for retrieved source info in chat response
class SourceInfoSchema(BaseModel):
    type: str
    filename: Optional[str] = None
    score: Optional[float] = None
    text: Optional[str] = None

# Schema for chat response payload
class ChatResponseSchema(BaseModel):
    response: str
    conversation_id: str
    sources: List[SourceInfoSchema] = []