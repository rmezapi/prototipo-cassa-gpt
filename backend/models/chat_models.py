# backend/models/chat_models.py
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func # For default timestamp
from .database import Base # Import Base from database.py

class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(String, primary_key=True, index=True) # Using the UUID string
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Add more fields later? e.g., user_id, summary

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")

class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, index=True) # Using the UUID string
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    speaker = Column(String, nullable=False) # 'user' or 'ai'
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Add more fields later? e.g., embedding_stored (boolean), qdrant_point_id

    conversation = relationship("Conversation", back_populates="messages")