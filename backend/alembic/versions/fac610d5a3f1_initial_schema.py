"""initial_schema

Revision ID: fac610d5a3f1
Revises:
Create Date: 2026-03-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "fac610d5a3f1"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS axshare")

    # Enums in schema axshare
    op.execute("CREATE TYPE axshare.userrole AS ENUM ('admin', 'user', 'guest')")
    op.execute("CREATE TYPE axshare.grouprole AS ENUM ('owner', 'admin', 'member')")
    op.execute("CREATE TYPE axshare.permissionlevel AS ENUM ('read', 'write', 'share', 'admin')")

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("display_name_encrypted", sa.Text(), nullable=False),
        sa.Column("role", postgresql.ENUM("admin", "user", "guest", name="userrole", schema="axshare", create_type=False), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_email_verified", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("public_key_rsa", sa.Text(), nullable=True),
        sa.Column("public_key_x25519", sa.Text(), nullable=True),
        sa.Column("private_key_encrypted", sa.Text(), nullable=True),
        sa.Column("key_derivation_salt", sa.String(128), nullable=True),
        sa.Column("webauthn_credentials", postgresql.JSONB(), nullable=True),
        sa.Column("totp_secret_encrypted", sa.Text(), nullable=True),
        sa.Column("totp_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_ip", sa.String(45), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )
    op.create_index(op.f("ix_axshare_users_email"), "users", ["email"], unique=True, schema="axshare")

    op.create_table(
        "groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name_encrypted", sa.Text(), nullable=False),
        sa.Column("description_encrypted", sa.Text(), nullable=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("group_key_version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["axshare.users.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )

    op.create_table(
        "group_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", postgresql.ENUM("owner", "admin", "member", name="grouprole", schema="axshare", create_type=False), nullable=False),
        sa.Column("encrypted_group_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["axshare.groups.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["axshare.users.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )

    op.create_table(
        "folders",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name_encrypted", sa.Text(), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("path_encrypted", sa.Text(), nullable=True),
        sa.Column("is_destroyed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("destroyed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["axshare.users.id"]),
        sa.ForeignKeyConstraint(["parent_id"], ["axshare.folders.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )

    op.create_table(
        "files",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name_encrypted", sa.Text(), nullable=False),
        sa.Column("mime_type_encrypted", sa.Text(), nullable=True),
        sa.Column("file_key_encrypted", sa.Text(), nullable=False),
        sa.Column("storage_path", sa.String(512), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("content_hash", sa.String(128), nullable=True),
        sa.Column("encryption_iv", sa.String(64), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("folder_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("is_latest", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("previous_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_destroyed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("destroyed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("self_destruct_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("self_destruct_after_downloads", sa.Integer(), nullable=True),
        sa.Column("download_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("metadata_encrypted", sa.Text(), nullable=True),
        sa.Column("classification", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["folder_id"], ["axshare.folders.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["axshare.users.id"]),
        sa.ForeignKeyConstraint(["previous_version_id"], ["axshare.files.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )
    op.create_index(op.f("ix_axshare_files_storage_path"), "files", ["storage_path"], unique=True, schema="axshare")

    op.create_table(
        "permissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("subject_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("subject_group_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resource_file_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resource_folder_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("level", postgresql.ENUM("read", "write", "share", "admin", name="permissionlevel", schema="axshare", create_type=False), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("resource_key_encrypted", sa.String(1024), nullable=True),
        sa.Column("granted_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["granted_by_id"], ["axshare.users.id"]),
        sa.ForeignKeyConstraint(["resource_file_id"], ["axshare.files.id"]),
        sa.ForeignKeyConstraint(["resource_folder_id"], ["axshare.folders.id"]),
        sa.ForeignKeyConstraint(["subject_group_id"], ["axshare.groups.id"]),
        sa.ForeignKeyConstraint(["subject_user_id"], ["axshare.users.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_email", sa.String(255), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("resource_type", sa.String(32), nullable=True),
        sa.Column("resource_id", sa.String(36), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=True),
        sa.Column("previous_hash", sa.String(128), nullable=True),
        sa.Column("log_hash", sa.String(128), nullable=True),
        sa.Column("outcome", sa.String(16), server_default=sa.text("'success'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["axshare.users.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )
    op.create_index(op.f("ix_axshare_audit_logs_action"), "audit_logs", ["action"], schema="axshare")

    op.create_table(
        "file_signatures",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("signer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("signature_type", sa.String(16), nullable=False),
        sa.Column("signature_data", sa.Text(), nullable=False),
        sa.Column("file_hash", sa.String(128), nullable=False),
        sa.Column("certificate_pem", sa.Text(), nullable=True),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_valid", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["file_id"], ["axshare.files.id"]),
        sa.ForeignKeyConstraint(["signer_id"], ["axshare.users.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="axshare",
    )


def downgrade() -> None:
    op.drop_table("file_signatures", schema="axshare")
    op.drop_index(op.f("ix_axshare_audit_logs_action"), table_name="audit_logs", schema="axshare")
    op.drop_table("audit_logs", schema="axshare")
    op.drop_table("permissions", schema="axshare")
    op.drop_index(op.f("ix_axshare_files_storage_path"), table_name="files", schema="axshare")
    op.drop_table("files", schema="axshare")
    op.drop_table("folders", schema="axshare")
    op.drop_table("group_members", schema="axshare")
    op.drop_table("groups", schema="axshare")
    op.drop_index(op.f("ix_axshare_users_email"), table_name="users", schema="axshare")
    op.drop_table("users", schema="axshare")

    op.execute("DROP TYPE IF EXISTS axshare.permissionlevel")
    op.execute("DROP TYPE IF EXISTS axshare.grouprole")
    op.execute("DROP TYPE IF EXISTS axshare.userrole")
    op.execute("DROP SCHEMA IF EXISTS axshare")
