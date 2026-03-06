"""add sync_events table

Revision ID: i9d0e1f2g3h4
Revises: h8c9d0e1f2g3
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "i9d0e1f2g3h4"
down_revision = "h8c9d0e1f2g3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "file_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.files.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "event_type",
            sa.String(32),
            nullable=False,
        ),
        sa.Column(
            "triggered_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("payload", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.create_index(
        "ix_sync_events_created_at",
        "sync_events",
        ["created_at"],
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_sync_events_created_at", table_name="sync_events", schema="axshare"
    )
    op.drop_table("sync_events", schema="axshare")
