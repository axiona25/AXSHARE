"""Add require_recipient_pin to share_links

Revision ID: x8y9z0a1b2c3
Revises: z7a8b9c0d1e2
Create Date: 2026-03-08

"""
from alembic import op
import sqlalchemy as sa

revision = "x8y9z0a1b2c3"
down_revision = "z7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "share_links",
        sa.Column(
            "require_recipient_pin",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        schema="axshare",
    )


def downgrade():
    op.drop_column("share_links", "require_recipient_pin", schema="axshare")
