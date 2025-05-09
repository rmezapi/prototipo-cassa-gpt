# backend/alembic/versions/a5c8a107a074_...your_migration_file.py
# (Make sure the revision ID and down_revision match your actual file)

"""Add KnowledgeBase, KnowledgeBaseDocument tables; link Conversation to KB; update Message FK

Revision ID: a5c8a107a074
Revises: 8a2d6f24c699
Create Date: 2025-04-11 16:01:41.526839

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5c8a107a074' # Use your actual revision ID
down_revision: Union[str, None] = '8a2d6f24c699' # Use your actual down_revision ID
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ### commands auto generated by Alembic - START ###

    # Create new tables - these usually don't need batch mode
    op.create_table('knowledge_bases',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    # Autogenerate might miss creating indexes on new tables sometimes, ensure they exist if needed by your model
    with op.batch_alter_table('knowledge_bases', schema=None) as batch_op: # Use batch just in case for index
        batch_op.create_index(batch_op.f('ix_knowledge_bases_name'), ['name'], unique=False)

    op.create_table('knowledge_base_documents',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('knowledge_base_id', sa.String(), nullable=False),
        sa.Column('qdrant_doc_id', sa.String(), nullable=False),
        sa.Column('filename', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.ForeignKeyConstraint(['knowledge_base_id'], ['knowledge_bases.id'], name=op.f('fk_knowledge_base_documents_knowledge_base_id_knowledge_bases')), # Name FK
        sa.PrimaryKeyConstraint('id')
    )
    # Use batch mode for creating indexes on the new table just to be safe with SQLite's ALTER limitations
    with op.batch_alter_table('knowledge_base_documents', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_knowledge_base_documents_knowledge_base_id'), ['knowledge_base_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_knowledge_base_documents_qdrant_doc_id'), ['qdrant_doc_id'], unique=True)
        batch_op.create_index(batch_op.f('ix_knowledge_base_documents_status'), ['status'], unique=False)

    # --- BATCH MODE for modifying existing 'conversations' table ---
    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('knowledge_base_id', sa.String(), nullable=True))
        # Create index and FK *within* the batch operation
        batch_op.create_index(batch_op.f('ix_conversations_knowledge_base_id'), ['knowledge_base_id'], unique=False)
        batch_op.create_foreign_key(
            batch_op.f('fk_conversations_knowledge_base_id_knowledge_bases'), # Use naming convention
            'knowledge_bases', ['knowledge_base_id'], ['id'])
    # --- END BATCH MODE ---

    # --- BATCH MODE for modifying existing 'messages' table ---
    # Note: The original migration added the related_doc_id column in a previous step (97d997bbe11a)
    # This migration step (a5c8...) seems to *only* be adding the foreign key for it.
    with op.batch_alter_table('messages', schema=None) as batch_op:
        # Check if related_doc_id column exists before trying to add FK? Usually not needed if revisions are correct.
        # Create the foreign key constraint referencing knowledge_base_documents.qdrant_doc_id
        batch_op.create_foreign_key(
             batch_op.f('fk_messages_related_doc_id_knowledge_base_documents'), # Use naming convention
            'knowledge_base_documents', ['related_doc_id'], ['qdrant_doc_id'])
    # --- END BATCH MODE ---


    # The operations on uploaded_documents index might also need batch mode if they involve ALTER
    with op.batch_alter_table('uploaded_documents', schema=None) as batch_op:
        # If 'ix_uploaded_documents_doc_id' existed before, drop it first
        # We check if it exists implicitly by just trying to drop (might error if doesn't exist, handle if necessary)
        try:
             # Assuming the old index name was 'ix_uploaded_documents_doc_id'
             batch_op.drop_index('ix_uploaded_documents_doc_id')
        except Exception:
             print("Ignoring error dropping old index ix_uploaded_documents_doc_id (might not exist).")
        # Create the new index using the naming convention
        batch_op.create_index(batch_op.f('ix_uploaded_documents_doc_id'), ['doc_id'], unique=False) # Changed unique=False based on original

    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - Adjust with batch mode ###

    with op.batch_alter_table('uploaded_documents', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_uploaded_documents_doc_id'))
        # Recreate the old index if needed? The original had unique=1 (True)
        # batch_op.create_index('ix_uploaded_documents_doc_id', ['doc_id'], unique=True) # If needed

    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_messages_related_doc_id_knowledge_base_documents'), type_='foreignkey')
        # Note: Drop column might have happened in the downgrade of the previous migration (97d997bbe11a)
        # Verify if the 'related_doc_id' column should be dropped here or in the downgrade of the migration that added it.
        # Assuming it was added in 97d997bbe11a, its drop should be there.

    with op.batch_alter_table('conversations', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_conversations_knowledge_base_id_knowledge_bases'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_conversations_knowledge_base_id'))
        batch_op.drop_column('knowledge_base_id')

    # Drop tables (don't need batch mode)
    with op.batch_alter_table('knowledge_base_documents', schema=None) as batch_op: # Added batch for index drop safety
         batch_op.drop_index(batch_op.f('ix_knowledge_base_documents_status'))
         batch_op.drop_index(batch_op.f('ix_knowledge_base_documents_qdrant_doc_id'))
         batch_op.drop_index(batch_op.f('ix_knowledge_base_documents_knowledge_base_id'))
    op.drop_table('knowledge_base_documents') # Drop table outside batch

    with op.batch_alter_table('knowledge_bases', schema=None) as batch_op: # Added batch for index drop safety
         batch_op.drop_index(batch_op.f('ix_knowledge_bases_name'))
    op.drop_table('knowledge_bases') # Drop table outside batch


    # ### end Alembic commands ###