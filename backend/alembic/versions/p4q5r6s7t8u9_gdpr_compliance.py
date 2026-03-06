"""gdpr compliance: deletion requests and consent log

Revision ID: p4q5r6s7t8u9
Revises: o3p4q5r6s7t8
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "p4q5r6s7t8u9"
down_revision = "o3p4q5r6s7t8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Richieste di cancellazione (Art. 17)
    op.create_table(
        "gdpr_deletion_requests",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("axshare.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("user_email_snapshot", sa.String(255), nullable=False),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(32),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deletion_summary", postgresql.JSONB, nullable=True),
        sa.Column("requested_by_ip", sa.String(45), nullable=True),
        schema="axshare",
    )

    # Log consensi (Art. 13/14)
    op.create_table(
        "gdpr_consent_log",
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
        sa.Column("consent_type", sa.String(64), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("version", sa.String(16), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(256), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="axshare",
    )
    op.create_index(
        "ix_consent_log_user_id",
        "gdpr_consent_log",
        ["user_id"],
        schema="axshare",
    )

    # Campi GDPR su users
    op.add_column(
        "users",
        sa.Column(
            "gdpr_erasure_requested_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="axshare",
    )
    op.add_column(
        "users",
        sa.Column(
            "data_retention_until",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="axshare",
    )
    op.add_column(
        "users",
        sa.Column(
            "is_anonymized",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_column("users", "is_anonymized", schema="axshare")
    op.drop_column("users", "data_retention_until", schema="axshare")
    op.drop_column("users", "gdpr_erasure_requested_at", schema="axshare")
    op.drop_index(
        "ix_consent_log_user_id",
        table_name="gdpr_consent_log",
        schema="axshare",
    )
    op.drop_table("gdpr_consent_log", schema="axshare")
    op.drop_table("gdpr_deletion_requests", schema="axshare")
