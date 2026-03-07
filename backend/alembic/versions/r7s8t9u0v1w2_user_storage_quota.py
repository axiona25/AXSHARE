"""user storage_quota_bytes (quota storage per utente, default 1GB)

Revision ID: r7s8t9u0v1w2
Revises: p4q5r6s7t8u9
Create Date: 2026-03-07

"""
from alembic import op
import sqlalchemy as sa

revision = "r7s8t9u0v1w2"
down_revision = "p4q5r6s7t8u9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "storage_quota_bytes",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("1073741824"),
        ),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("users", "storage_quota_bytes", schema="axshare")
