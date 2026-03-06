"""share_links: slug -> token, add is_password_protected, share_link_accesses

Revision ID: l2g3h4i5j6k7
Revises: k1f2g3h4i5j6
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "l2g3h4i5j6k7"
down_revision = "k1f2g3h4i5j6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    r = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'axshare' AND table_name = 'share_links' "
            "AND column_name = 'token'"
        )
    ).fetchone()
    if r is not None:
        return  # già schema nuovo (token presente)

    op.add_column(
        "share_links",
        sa.Column("token", sa.String(64), nullable=True),
        schema="axshare",
    )
    op.execute(
        sa.text("UPDATE axshare.share_links SET token = slug WHERE token IS NULL")
    )
    op.alter_column(
        "share_links",
        "token",
        existing_type=sa.String(64),
        nullable=False,
        schema="axshare",
    )
    op.drop_index("ix_share_links_slug", table_name="share_links", schema="axshare")
    op.drop_column("share_links", "slug", schema="axshare")
    op.create_index(
        "ix_share_links_token",
        "share_links",
        ["token"],
        schema="axshare",
        unique=True,
    )
    op.add_column(
        "share_links",
        sa.Column(
            "is_password_protected",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.execute(
        sa.text(
            "ALTER TABLE axshare.share_links "
            "DROP COLUMN IF EXISTS expires_mode"
        )
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
    op.drop_column(
        "share_links",
        "is_password_protected",
        schema="axshare",
    )
    op.drop_index("ix_share_links_token", table_name="share_links", schema="axshare")
    op.add_column(
        "share_links",
        sa.Column("slug", sa.String(64), nullable=True),
        schema="axshare",
    )
    op.execute(sa.text("UPDATE axshare.share_links SET slug = token"))
    op.alter_column(
        "share_links",
        "slug",
        existing_type=sa.String(64),
        nullable=False,
        schema="axshare",
    )
    op.drop_column("share_links", "token", schema="axshare")
    op.create_index(
        "ix_share_links_slug",
        "share_links",
        ["slug"],
        schema="axshare",
        unique=True,
    )
    op.add_column(
        "share_links",
        sa.Column(
            "expires_mode",
            sa.String(16),
            nullable=False,
            server_default=sa.text("'forever'"),
        ),
        schema="axshare",
    )
