"""add file signatures table (RSA-PSS)

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Sostituisce la tabella file_signatures esistente con schema RSA-PSS
    op.drop_table("file_signatures", schema="axshare")

    op.create_table(
        "file_signatures",
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
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column(
            "signer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("signature_b64", sa.Text(), nullable=False),
        sa.Column("file_hash_sha256", sa.String(64), nullable=False),
        sa.Column("public_key_pem_snapshot", sa.Text(), nullable=False),
        sa.Column(
            "algorithm",
            sa.String(32),
            nullable=False,
            server_default=sa.text("'RSA-PSS-SHA256'"),
        ),
        sa.Column("is_valid", sa.Boolean(), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.create_index(
        "ix_file_signatures_file_id",
        "file_signatures",
        ["file_id"],
        schema="axshare",
    )
    op.create_index(
        "ix_file_signatures_signer",
        "file_signatures",
        ["signer_id"],
        schema="axshare",
    )
    op.create_unique_constraint(
        "uq_file_signature_version",
        "file_signatures",
        ["file_id", "version"],
        schema="axshare",
    )

    op.add_column(
        "files",
        sa.Column(
            "is_signed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("files", "is_signed", schema="axshare")
    op.drop_constraint(
        "uq_file_signature_version",
        "file_signatures",
        schema="axshare",
    )
    op.drop_index(
        "ix_file_signatures_signer",
        table_name="file_signatures",
        schema="axshare",
    )
    op.drop_index(
        "ix_file_signatures_file_id",
        table_name="file_signatures",
        schema="axshare",
    )
    op.drop_table("file_signatures", schema="axshare")
