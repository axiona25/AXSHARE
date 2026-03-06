"""guest_sessions: add guest_email, invite_token, expires_at, etc.

Revision ID: m3h4i5j6k7l8
Revises: l2g3h4i5j6k7
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "m3h4i5j6k7l8"
down_revision = "l2g3h4i5j6k7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "guest_sessions",
        sa.Column("guest_email", sa.String(255), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "guest_sessions",
        sa.Column("invite_token", sa.String(64), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "guest_sessions",
        sa.Column("invite_used_at", sa.DateTime(timezone=True), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "guest_sessions",
        sa.Column("session_token_jti", sa.String(64), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "guest_sessions",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        schema="axshare",
    )
    op.execute(
        sa.text(
            "UPDATE axshare.guest_sessions SET guest_email = '' WHERE guest_email IS NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE axshare.guest_sessions SET invite_token = "
            "replace(gen_random_uuid()::text, '-', '') WHERE invite_token IS NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE axshare.guest_sessions SET expires_at = now() + interval '7 days' "
            "WHERE expires_at IS NULL"
        )
    )
    op.alter_column(
        "guest_sessions",
        "guest_email",
        existing_type=sa.String(255),
        nullable=False,
        schema="axshare",
    )
    op.alter_column(
        "guest_sessions",
        "invite_token",
        existing_type=sa.String(64),
        nullable=False,
        schema="axshare",
    )
    op.alter_column(
        "guest_sessions",
        "expires_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        schema="axshare",
    )
    op.create_index(
        "ix_guest_sessions_invite_token",
        "guest_sessions",
        ["invite_token"],
        schema="axshare",
        unique=True,
    )
    op.create_index(
        "ix_guest_sessions_guest_email",
        "guest_sessions",
        ["guest_email"],
        schema="axshare",
    )

    op.add_column(
        "guest_permissions",
        sa.Column("file_key_encrypted_for_guest", sa.Text(), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "guest_permissions",
        sa.Column(
            "can_download",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.add_column(
        "guest_permissions",
        sa.Column(
            "can_preview",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.create_unique_constraint(
        "uq_guest_permission",
        "guest_permissions",
        ["session_id", "file_id"],
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_guest_sessions_guest_email",
        table_name="guest_sessions",
        schema="axshare",
    )
    op.drop_index(
        "ix_guest_sessions_invite_token",
        table_name="guest_sessions",
        schema="axshare",
    )
    op.drop_column("guest_sessions", "expires_at", schema="axshare")
    op.drop_column("guest_sessions", "session_token_jti", schema="axshare")
    op.drop_column("guest_sessions", "invite_used_at", schema="axshare")
    op.drop_column("guest_sessions", "invite_token", schema="axshare")
    op.drop_column("guest_sessions", "guest_email", schema="axshare")
    op.drop_constraint(
        "uq_guest_permission",
        "guest_permissions",
        schema="axshare",
        type_="unique",
    )
    op.drop_column("guest_permissions", "can_preview", schema="axshare")
    op.drop_column("guest_permissions", "can_download", schema="axshare")
    op.drop_column("guest_permissions", "file_key_encrypted_for_guest", schema="axshare")
