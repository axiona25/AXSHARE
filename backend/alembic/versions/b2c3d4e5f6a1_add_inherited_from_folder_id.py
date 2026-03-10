"""Add inherited_from_folder_id to permissions for folder->file inheritance

Revision ID: b2c3d4e5f6a1
Revises: z0a1b2c3d4e5
Create Date: 2026-03-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c3d4e5f6a1"
down_revision: Union[str, None] = "z0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "permissions",
        sa.Column(
            "inherited_from_folder_id",
            sa.UUID(),
            sa.ForeignKey("axshare.folders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("permissions", "inherited_from_folder_id", schema="axshare")
