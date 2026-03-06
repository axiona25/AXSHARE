"""add signing public key to users

Revision ID: k1f2g3h4i5j6
Revises: j0e1f2g3h4i5
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa

revision = "k1f2g3h4i5j6"
down_revision = "j0e1f2g3h4i5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("signing_public_key_pem", sa.Text(), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "users",
        sa.Column(
            "signing_key_registered_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("users", "signing_key_registered_at", schema="axshare")
    op.drop_column("users", "signing_public_key_pem", schema="axshare")
