# backend/models/chat_models.py
import uuid
import datetime # Ensure datetime is imported
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Enum # Added Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base # Import Base from database.py

# Define status Enum for documents
# Using simple strings now, Enum adds slight complexity for SQLite/Alembic sometimes
# class DocumentStatus(str, enum.Enum):
#     PROCESSING = "processing"
#     COMPLETED = "completed"
#     ERROR = "error"


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(String, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # --- ADD Foreign Key and Relationship to KnowledgeBase ---
    knowledge_base_id = Column(String, ForeignKey("knowledge_bases.id"), nullable=True, index=True)
    knowledge_base = relationship("KnowledgeBase", back_populates="conversations")
    # --- END ADD ---

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan", lazy="selectin")
    uploaded_documents = relationship("UploadedDocument", back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, index=True)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    speaker = Column(String, nullable=False) # 'user', 'ai', 'system'
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # This field links a 'system' message about an upload to the KB document record
    related_doc_id = Column(String, ForeignKey("knowledge_base_documents.qdrant_doc_id"), nullable=True, index=True)

    conversation = relationship("Conversation", back_populates="messages")


class UploadedDocument(Base): # This is for session uploads, distinct from KB docs
    __tablename__ = "uploaded_documents" # Keep this table for session-specific uploads

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4())) # Row ID
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    # Unique ID grouping chunks in Qdrant 'collection_uploads'
    doc_id = Column(String, nullable=False, index=True) # Not necessarily unique across all uploads
    filename = Column(String, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    conversation = relationship("Conversation", back_populates="uploaded_documents")


# --- NEW KnowledgeBase MODEL ---
class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Add updated_at?

    # Relationship back to Conversations linked to this KB
    conversations = relationship("Conversation", back_populates="knowledge_base")
    # Relationship to documents within this KB
    documents = relationship("KnowledgeBaseDocument", back_populates="knowledge_base", cascade="all, delete-orphan")


# --- NEW KnowledgeBaseDocument MODEL ---
class KnowledgeBaseDocument(Base):
    __tablename__ = "knowledge_base_documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4())) # Row ID
    knowledge_base_id = Column(String, ForeignKey("knowledge_bases.id"), nullable=False, index=True)

    # Unique ID grouping chunks for THIS document in Qdrant 'collection_kb'
    # Should be unique within the KB, maybe globally? Let's make globally unique for simplicity.
    qdrant_doc_id = Column(String, nullable=False, unique=True, index=True, default=lambda: str(uuid.uuid4()))

    filename = Column(String, nullable=False)
    status = Column(String, nullable=False, default="processing", index=True) # Use simple strings: "processing", "completed", "error"
    # status = Column(Enum(DocumentStatus), nullable=False, default=DocumentStatus.PROCESSING, index=True) # If using Enum
    error_message = Column(Text, nullable=True) # Store error details if status is 'error'
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    # Add chunk_count, file_size, file_type later?

    knowledge_base = relationship("KnowledgeBase", back_populates="documents")