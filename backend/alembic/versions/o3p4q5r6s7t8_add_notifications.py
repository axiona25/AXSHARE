"""add notifications table

Revision ID: o3p4q5r6s7t8
Revises: n2o3p4q5r6s7
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "o3p4q5r6s7t8"
down_revision = "n2o3p4q5r6s7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("title", sa.String(256), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("resource_type", sa.String(32), nullable=True),
        sa.Column("resource_id", sa.String(64), nullable=True),
        sa.Column("action_url", sa.String(512), nullable=True),
        sa.Column(
            "is_read",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "severity",
            sa.String(16),
            nullable=False,
            server_default=sa.text("'info'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.create_index(
        "ix_notifications_user_id",
        "notifications",
        ["user_id"],
        schema="axshare",
    )
    op.create_index(
        "ix_notifications_is_read",
        "notifications",
        ["is_read"],
        schema="axshare",
    )
    op.create_index(
        "ix_notifications_created_at",
        "notifications",
        ["created_at"],
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_notifications_created_at",
        table_name="notifications",
        schema="axshare",
    )
    op.drop_index(
        "ix_notifications_is_read",
        table_name="notifications",
        schema="axshare",
    )
    op.drop_index(
        "ix_notifications_user_id",
        table_name="notifications",
        schema="axshare",
    )
    op.drop_table("notifications", schema="axshare")
