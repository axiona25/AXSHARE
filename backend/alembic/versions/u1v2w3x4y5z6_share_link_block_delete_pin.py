"""Add block_delete, require_pin, pin_hash to share_links.

Revision ID: u1v2w3x4y5z6
Revises: a1b2c3d4e5f6
Create Date: 2026-03-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "u1v2w3x4y5z6"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "share_links",
        sa.Column("block_delete", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema="axshare",
    )
    op.add_column(
        "share_links",
        sa.Column("require_pin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema="axshare",
    )
    op.add_column(
        "share_links",
        sa.Column("pin_hash", sa.Text(), nullable=True),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("share_links", "pin_hash", schema="axshare")
    op.drop_column("share_links", "require_pin", schema="axshare")
    op.drop_column("share_links", "block_delete", schema="axshare")
