"""add folder_key_encrypted to folders

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-04

Aggiunge colonna folder_key_encrypted (chiave cartella cifrata con pubkey owner).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "folders",
        sa.Column("folder_key_encrypted", sa.Text(), nullable=True),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("folders", "folder_key_encrypted", schema="axshare")
