# backend/models/chat_models.py
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship # Ensure relationship is imported
from sqlalchemy.sql import func
from .database import Base
import uuid

class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(String, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Existing relationship to Message
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan", lazy="selectin")

    # --- ADD THIS RELATIONSHIP ---
    # Defines the one-to-many relationship from Conversation to UploadedDocument
    uploaded_documents = relationship(
        "UploadedDocument", # The class name it relates to
        back_populates="conversation", # The attribute name on UploadedDocument that points back
        cascade="all, delete-orphan" # Optional: Delete documents if conversation is deleted
    )
    # --- END ADDED RELATIONSHIP ---


class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, index=True)
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    speaker = Column(String, nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    related_doc_id = Column(String, nullable=True, index=True)

    conversation = relationship("Conversation", back_populates="messages")


class UploadedDocument(Base):
    __tablename__ = "uploaded_documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    doc_id = Column(String, nullable=False, index=True, unique=True)
    filename = Column(String, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # This relationship expects 'uploaded_documents' on the Conversation model
    conversation = relationship("Conversation", back_populates="uploaded_documents")