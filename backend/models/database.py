# backend/models/database.py
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
# *** Import declarative_base to DEFINE Base ***
from sqlalchemy.ext.declarative import declarative_base

load_dotenv()

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

if not SQLALCHEMY_DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable not set or .env file not found")

print(f"Attempting to connect to DB: {SQLALCHEMY_DATABASE_URL[:30]}...")

# *** DEFINE Base here ***
Base = declarative_base()

# Modify engine creation
if SQLALCHEMY_DATABASE_URL.startswith("postgresql"):
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    print("Using PostgreSQL engine.")
# Remove or comment out SQLite part if not needed as fallback
# elif SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
#     engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
#     print("Using SQLite engine.")
else:
     raise ValueError(f"Unsupported database URL prefix: {SQLALCHEMY_DATABASE_URL[:15]}...")

# SessionLocal and get_db remain the same
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# *** REMOVE the incorrect import from chat_models ***
# from models.chat_models import Base # <--- DELETE THIS LINE

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()