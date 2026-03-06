"""add audit log centralized (actor, session_type, error_message, indexes)

Revision ID: n2o3p4q5r6s7
Revises: m3h4i5j6k7l8
Create Date: 2026-03-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "n2o3p4q5r6s7"
down_revision = "m3h4i5j6k7l8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns for centralized audit (actor, session_type, error_message, resource_name)
    op.add_column(
        "audit_logs",
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "audit_logs",
        sa.Column("actor_email", sa.String(255), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "audit_logs",
        sa.Column("actor_role", sa.String(32), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "audit_logs",
        sa.Column("resource_name_encrypted", sa.Text(), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "audit_logs",
        sa.Column("error_message", sa.Text(), nullable=True),
        schema="axshare",
    )
    op.add_column(
        "audit_logs",
        sa.Column("session_type", sa.String(16), nullable=True),
        schema="axshare",
    )
    op.create_foreign_key(
        "fk_audit_logs_actor_id",
        "audit_logs",
        "users",
        ["actor_id"],
        ["id"],
        source_schema="axshare",
        referent_schema="axshare",
        ondelete="SET NULL",
    )
    # Backfill actor_* from user_id/user_email
    op.execute(
        sa.text(
            "UPDATE axshare.audit_logs SET actor_id = user_id, actor_email = user_email WHERE actor_id IS NULL"
        )
    )
    # Indexes for query
    op.create_index(
        "ix_audit_actor_id",
        "audit_logs",
        ["actor_id"],
        schema="axshare",
    )
    op.create_index(
        "ix_audit_resource",
        "audit_logs",
        ["resource_type", "resource_id"],
        schema="axshare",
    )
    op.create_index(
        "ix_audit_created_at",
        "audit_logs",
        ["created_at"],
        schema="axshare",
    )
    op.create_index(
        "ix_audit_outcome",
        "audit_logs",
        ["outcome"],
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_index("ix_audit_outcome", table_name="audit_logs", schema="axshare")
    op.drop_index("ix_audit_created_at", table_name="audit_logs", schema="axshare")
    op.drop_index("ix_audit_resource", table_name="audit_logs", schema="axshare")
    op.drop_index("ix_audit_actor_id", table_name="audit_logs", schema="axshare")
    op.drop_constraint(
        "fk_audit_logs_actor_id",
        "audit_logs",
        schema="axshare",
        type_="foreignkey",
    )
    op.drop_column("audit_logs", "session_type", schema="axshare")
    op.drop_column("audit_logs", "error_message", schema="axshare")
    op.drop_column("audit_logs", "resource_name_encrypted", schema="axshare")
    op.drop_column("audit_logs", "actor_role", schema="axshare")
    op.drop_column("audit_logs", "actor_email", schema="axshare")
    op.drop_column("audit_logs", "actor_id", schema="axshare")
