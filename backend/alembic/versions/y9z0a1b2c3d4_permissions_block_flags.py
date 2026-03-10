"""Add block_delete, block_link, require_pin to permissions

Revision ID: y9z0a1b2c3d4
Revises: s9t0u1v2w3x4
Create Date: 2026-03-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "y9z0a1b2c3d4"
down_revision: Union[str, None] = "s9t0u1v2w3x4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "permissions",
        sa.Column("block_delete", sa.Boolean(), nullable=False, server_default="false"),
        schema="axshare",
    )
    op.add_column(
        "permissions",
        sa.Column("block_link", sa.Boolean(), nullable=False, server_default="false"),
        schema="axshare",
    )
    op.add_column(
        "permissions",
        sa.Column("require_pin", sa.Boolean(), nullable=False, server_default="false"),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("permissions", "block_delete", schema="axshare")
    op.drop_column("permissions", "block_link", schema="axshare")
    op.drop_column("permissions", "require_pin", schema="axshare")
