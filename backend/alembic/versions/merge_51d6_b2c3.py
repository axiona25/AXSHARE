"""Merge heads 51d61139ce5a and b2c3d4e5f6a1

Revision ID: merge_51d6_b2c3
Revises: 51d61139ce5a, b2c3d4e5f6a1
Create Date: 2026-03-10

"""
from typing import Sequence, Union

from alembic import op


revision: str = "merge_51d6_b2c3"
down_revision: Union[str, None] = ("51d61139ce5a", "b2c3d4e5f6a1")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
