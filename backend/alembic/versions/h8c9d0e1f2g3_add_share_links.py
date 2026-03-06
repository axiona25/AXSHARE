"""add share links table

Revision ID: h8c9d0e1f2g3
Revises: f6a7b8c9d0e1
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "h8c9d0e1f2g3"
down_revision = "f6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "share_links",
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
            nullable=False,
        ),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("file_key_encrypted_for_link", sa.Text(), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column(
            "is_password_protected",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_downloads", sa.Integer(), nullable=True),
        sa.Column(
            "download_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("label", sa.String(128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.create_index(
        "ix_share_links_token",
        "share_links",
        ["token"],
        schema="axshare",
        unique=True,
    )
    op.create_index(
        "ix_share_links_file_id",
        "share_links",
        ["file_id"],
        schema="axshare",
    )
    op.create_index(
        "ix_share_links_owner_id",
        "share_links",
        ["owner_id"],
        schema="axshare",
    )

    op.create_table(
        "share_link_accesses",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "link_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.share_links.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(256), nullable=True),
        sa.Column(
            "accessed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "outcome",
            sa.String(32),
            nullable=False,
            server_default=sa.text("'success'"),
        ),
        schema="axshare",
    )
    op.create_index(
        "ix_share_link_accesses_link_id",
        "share_link_accesses",
        ["link_id"],
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_share_link_accesses_link_id",
        table_name="share_link_accesses",
        schema="axshare",
    )
    op.drop_table("share_link_accesses", schema="axshare")
    op.drop_index("ix_share_links_owner_id", table_name="share_links", schema="axshare")
    op.drop_index("ix_share_links_file_id", table_name="share_links", schema="axshare")
    op.drop_index("ix_share_links_token", table_name="share_links", schema="axshare")
    op.drop_table("share_links", schema="axshare")
