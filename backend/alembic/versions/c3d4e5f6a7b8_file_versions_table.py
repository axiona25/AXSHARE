"""file_versions table for versioning

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-04

Tabella per snapshot delle versioni precedenti (rollback).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "file_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(512), nullable=False),
        sa.Column("file_key_encrypted", sa.Text(), nullable=False),
        sa.Column("encryption_iv", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["file_id"], ["axshare.files.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["axshare.users.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )
    op.create_index(
        op.f("ix_axshare_file_versions_file_id"),
        "file_versions",
        ["file_id"],
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_axshare_file_versions_file_id"), table_name="file_versions", schema="axshare")
    op.drop_table("file_versions", schema="axshare")
