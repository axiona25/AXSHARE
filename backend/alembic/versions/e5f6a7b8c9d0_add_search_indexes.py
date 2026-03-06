"""add search indexes for files and tags

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-05

Indici per ricerca: mime_category, owner_created, starred, pinned, size, GIN su tag.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "files",
        sa.Column("mime_category", sa.String(32), nullable=True),
        schema="axshare",
    )
    op.create_index(
        "ix_files_mime_category", "files", ["mime_category"], schema="axshare"
    )
    op.create_index(
        "ix_files_owner_created",
        "files",
        ["owner_id", "created_at"],
        schema="axshare",
    )
    op.create_index(
        "ix_files_is_starred", "files", ["is_starred"], schema="axshare"
    )
    op.create_index(
        "ix_files_is_pinned", "files", ["is_pinned"], schema="axshare"
    )
    op.create_index("ix_files_size", "files", ["size_bytes"], schema="axshare")

    op.execute("""
        CREATE INDEX ix_file_tags_gin ON axshare.file_tags
        USING gin(to_tsvector('simple', tag))
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS axshare.ix_file_tags_gin")
    op.drop_index("ix_files_size", table_name="files", schema="axshare")
    op.drop_index("ix_files_is_pinned", table_name="files", schema="axshare")
    op.drop_index("ix_files_is_starred", table_name="files", schema="axshare")
    op.drop_index(
        "ix_files_owner_created", table_name="files", schema="axshare"
    )
    op.drop_index(
        "ix_files_mime_category", table_name="files", schema="axshare"
    )
    op.drop_column("files", "mime_category", schema="axshare")
