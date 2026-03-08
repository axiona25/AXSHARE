"""add_activity_log

Revision ID: 2c6a2b92e26b
Revises: t0u1v2w3x4y5
Create Date: 2026-03-08 14:04:22.569852

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "2c6a2b92e26b"
down_revision: Union[str, None] = "t0u1v2w3x4y5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.UUID(), nullable=False),
        sa.Column("target_name", sa.Text(), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["axshare.users.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_table("activity_logs", schema="axshare")
