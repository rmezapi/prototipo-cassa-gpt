# backend/alembic/env.py
import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config # Keep this
from sqlalchemy import pool # Keep this
from sqlalchemy import create_engine # Keep this

from alembic import context

# --- ADDED: Load .env for database URL ---
from dotenv import load_dotenv
# Correct path assuming env.py is inside alembic directory, which is inside backend
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)
# --- END ADDED ---

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# --- ADDED: Set SQLAlchemy URL from environment variable ---
db_url = os.getenv("DATABASE_URL")
if not db_url:
    raise ValueError("DATABASE_URL environment variable not found. Ensure .env is loaded or variable is set.")
config.set_main_option("sqlalchemy.url", db_url)
# --- END ADDED ---


# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# --- Correct Base Import and Model Import ---
# Import Base from where it's defined (database.py)
from models.database import Base
# Import your models module(s) HERE so Base registers the tables
import models.chat_models # Or: from models import chat_models
# --- End Correct Imports ---

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    # url = config.get_main_option("sqlalchemy.url") # Already set above
    url = db_url # Use the URL loaded from env
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # render_as_batch=False, # Ensure batch is off for Postgres
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    # Use the engine created directly from the env var URL
    connectable = create_engine(db_url)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata
            # render_as_batch=False, # Ensure batch is off for Postgres
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()