"""add file metadata and tags

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-03-05

Metadati cifrati per file, tag non cifrati, flag starred/pinned/color su files.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "file_metadata",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "file_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.files.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("description_encrypted", sa.Text(), nullable=True),
        sa.Column("notes_encrypted", sa.Text(), nullable=True),
        sa.Column("custom_fields_encrypted", sa.Text(), nullable=True),
        sa.Column("thumbnail_encrypted", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="axshare",
    )

    op.create_table(
        "file_tags",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "file_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.files.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tag", sa.String(64), nullable=False),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.create_unique_constraint(
        "uq_file_tag", "file_tags", ["file_id", "tag"], schema="axshare"
    )
    op.create_index(
        "ix_file_tags_file_id", "file_tags", ["file_id"], schema="axshare"
    )
    op.create_index("ix_file_tags_tag", "file_tags", ["tag"], schema="axshare")

    op.add_column(
        "files",
        sa.Column(
            "is_starred",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.add_column(
        "files",
        sa.Column(
            "is_pinned",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.add_column(
        "files",
        sa.Column("color_label", sa.String(16), nullable=True),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("files", "color_label", schema="axshare")
    op.drop_column("files", "is_pinned", schema="axshare")
    op.drop_column("files", "is_starred", schema="axshare")
    op.drop_index(
        "ix_file_tags_tag", table_name="file_tags", schema="axshare"
    )
    op.drop_index(
        "ix_file_tags_file_id", table_name="file_tags", schema="axshare"
    )
    op.drop_table("file_tags", schema="axshare")
    op.drop_table("file_metadata", schema="axshare")
