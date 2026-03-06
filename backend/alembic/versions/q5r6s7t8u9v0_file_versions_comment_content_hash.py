"""file_versions: add comment and content_hash for unlimited versioning

Revision ID: q5r6s7t8u9v0
Revises: p4q5r6s7t8u9
Create Date: 2026-03-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "q5r6s7t8u9v0"
down_revision: Union[str, None] = "p4q5r6s7t8u9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "file_versions",
        sa.Column("content_hash", sa.String(128), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "file_versions",
        sa.Column("comment", sa.Text(), nullable=True),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("file_versions", "content_hash", schema="axshare")
    op.drop_column("file_versions", "comment", schema="axshare")
