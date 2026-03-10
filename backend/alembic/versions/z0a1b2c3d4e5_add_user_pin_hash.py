"""Add pin_hash to users for PIN verification (require_pin flow)

Revision ID: z0a1b2c3d4e5
Revises: y9z0a1b2c3d4
Create Date: 2026-03-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "z0a1b2c3d4e5"
down_revision: Union[str, None] = "y9z0a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("pin_hash", sa.Text(), nullable=True),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("users", "pin_hash", schema="axshare")
