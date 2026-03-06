"""enable_rls

Revision ID: a1b2c3d4e5f6
Revises: fac610d5a3f1
Create Date: 2026-03-04

Row Level Security: ogni utente vede solo i propri dati.
L'applicazione imposta axshare.current_user_id con SET LOCAL.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "fac610d5a3f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE axshare.files ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE axshare.folders ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE axshare.permissions ENABLE ROW LEVEL SECURITY")
    # Force RLS also for table owner (app connects as owner)
    op.execute("ALTER TABLE axshare.files FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE axshare.folders FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE axshare.permissions FORCE ROW LEVEL SECURITY")

    op.execute("""
        CREATE POLICY files_owner_policy ON axshare.files
        FOR ALL
        USING (owner_id::text = current_setting('axshare.current_user_id', true))
    """)
    op.execute("""
        CREATE POLICY folders_owner_policy ON axshare.folders
        FOR ALL
        USING (owner_id::text = current_setting('axshare.current_user_id', true))
    """)
    op.execute("""
        CREATE POLICY permissions_owner_policy ON axshare.permissions
        FOR ALL
        USING (
            granted_by_id::text = current_setting('axshare.current_user_id', true)
            OR subject_user_id::text = current_setting('axshare.current_user_id', true)
        )
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS permissions_owner_policy ON axshare.permissions")
    op.execute("DROP POLICY IF EXISTS folders_owner_policy ON axshare.folders")
    op.execute("DROP POLICY IF EXISTS files_owner_policy ON axshare.files")

    op.execute("ALTER TABLE axshare.permissions DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE axshare.folders DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE axshare.files DISABLE ROW LEVEL SECURITY")
