"""add_folder_color

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-03-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "t0u1v2w3x4y5"
down_revision: Union[str, None] = "s9t0u1v2w3x4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "folders",
        sa.Column("color", sa.String(32), nullable=True, server_default="yellow"),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("folders", "color", schema="axshare")
