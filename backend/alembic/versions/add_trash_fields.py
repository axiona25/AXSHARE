"""Add trash fields to files and folders

Revision ID: z7a8b9c0d1e2
Revises: 2c6a2b92e26b
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'z7a8b9c0d1e2'
down_revision = '2c6a2b92e26b'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('files',
        sa.Column('is_trashed', sa.Boolean(),
        nullable=False, server_default='false'),
        schema='axshare')
    op.add_column('files',
        sa.Column('trashed_at', sa.DateTime(timezone=True),
        nullable=True), schema='axshare')
    op.add_column('files',
        sa.Column('original_folder_id',
        postgresql.UUID(as_uuid=True), nullable=True),
        schema='axshare')
    op.add_column('folders',
        sa.Column('is_trashed', sa.Boolean(),
        nullable=False, server_default='false'),
        schema='axshare')
    op.add_column('folders',
        sa.Column('trashed_at', sa.DateTime(timezone=True),
        nullable=True), schema='axshare')
    op.add_column('folders',
        sa.Column('original_folder_id',
        postgresql.UUID(as_uuid=True), nullable=True),
        schema='axshare')


def downgrade():
    for col in ['is_trashed', 'trashed_at', 'original_folder_id']:
        op.drop_column('files', col, schema='axshare')
        op.drop_column('folders', col, schema='axshare')
