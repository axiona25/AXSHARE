"""merge_heads

Revision ID: 51d61139ce5a
Revises: u1v2w3x4y5z6, x8y9z0a1b2c3, z0a1b2c3d4e5
Create Date: 2026-03-10 07:33:01.733593

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '51d61139ce5a'
down_revision: Union[str, None] = ('u1v2w3x4y5z6', 'x8y9z0a1b2c3', 'z0a1b2c3d4e5')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
