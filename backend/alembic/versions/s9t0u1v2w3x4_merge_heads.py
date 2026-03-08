"""merge heads (q5r6s7t8u9v0, r7s8t9u0v1w2)

Revision ID: s9t0u1v2w3x4
Revises: q5r6s7t8u9v0, r7s8t9u0v1w2
Create Date: 2026-03-08

"""
from typing import Sequence, Union

from alembic import op

revision: str = "s9t0u1v2w3x4"
down_revision: Union[str, Sequence[str], None] = ("q5r6s7t8u9v0", "r7s8t9u0v1w2")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
