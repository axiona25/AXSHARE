"""
Elimina un utente dal DB per email (e tutte le righe correlate).
Uso: dalla cartella backend:
  python -m scripts.delete_user_by_email r.amoroso80@gmail.com
  oppure
  uv run python -m scripts.delete_user_by_email r.amoroso80@gmail.com
"""
import asyncio
import sys

from sqlalchemy import text, select
from app.database import engine
from app.models.user import User


async def main():
    if len(sys.argv) < 2:
        print("Uso: python -m scripts.delete_user_by_email <email>")
        sys.exit(1)
    email = sys.argv[1].strip()
    if not email:
        print("Fornire un'email valida.")
        sys.exit(1)

    async with engine.begin() as conn:
        result = await conn.execute(select(User.id).where(User.email == email))
        row = result.fetchone()
        if not row:
            print(f"Nessun utente trovato con email: {email}")
            sys.exit(0)
        user_id = row[0]
        uid_str = str(user_id)

        # Ordine: tabelle figlie prima, poi user
        await conn.execute(text("DELETE FROM axshare.activity_logs WHERE user_id = :uid"), {"uid": user_id})
        await conn.execute(
            text("DELETE FROM axshare.share_link_accesses WHERE link_id IN (SELECT id FROM axshare.share_links WHERE owner_id = :uid)"),
            {"uid": user_id},
        )
        await conn.execute(text("DELETE FROM axshare.share_links WHERE owner_id = :uid"), {"uid": user_id})
        # Permissions: subject, granted_by, e quelle su file/folder dell'utente
        await conn.execute(text("DELETE FROM axshare.permissions WHERE subject_user_id = :uid"), {"uid": user_id})
        await conn.execute(text("DELETE FROM axshare.permissions WHERE granted_by_id = :uid"), {"uid": user_id})
        await conn.execute(
            text("DELETE FROM axshare.permissions WHERE resource_file_id IN (SELECT id FROM axshare.files WHERE owner_id = :uid)"),
            {"uid": user_id},
        )
        await conn.execute(
            text("DELETE FROM axshare.permissions WHERE resource_folder_id IN (SELECT id FROM axshare.folders WHERE owner_id = :uid)"),
            {"uid": user_id},
        )
        # File signatures (firmati dall'utente o su file dell'utente)
        await conn.execute(text("DELETE FROM axshare.file_signatures WHERE signer_id = :uid"), {"uid": user_id})
        await conn.execute(
            text("DELETE FROM axshare.file_signatures WHERE file_id IN (SELECT id FROM axshare.files WHERE owner_id = :uid)"),
            {"uid": user_id},
        )
        await conn.execute(
            text("DELETE FROM axshare.file_versions WHERE file_id IN (SELECT id FROM axshare.files WHERE owner_id = :uid)"),
            {"uid": user_id},
        )
        # file_metadata e file_tags se esistono
        await conn.execute(
            text("DELETE FROM axshare.file_metadata WHERE file_id IN (SELECT id FROM axshare.files WHERE owner_id = :uid)"),
            {"uid": user_id},
        )
        await conn.execute(
            text("DELETE FROM axshare.file_tags WHERE file_id IN (SELECT id FROM axshare.files WHERE owner_id = :uid)"),
            {"uid": user_id},
        )
        await conn.execute(text("DELETE FROM axshare.files WHERE owner_id = :uid"), {"uid": user_id})
        # Cartelle: prima annulla parent_id poi elimina
        await conn.execute(text("UPDATE axshare.folders SET parent_id = NULL WHERE owner_id = :uid"), {"uid": user_id})
        await conn.execute(text("DELETE FROM axshare.folders WHERE owner_id = :uid"), {"uid": user_id})
        await conn.execute(text("DELETE FROM axshare.group_members WHERE user_id = :uid"), {"uid": user_id})
        await conn.execute(text("DELETE FROM axshare.groups WHERE owner_id = :uid"), {"uid": user_id})
        await conn.execute(text("DELETE FROM axshare.notifications WHERE user_id = :uid"), {"uid": user_id})
        await conn.execute(text("DELETE FROM axshare.users WHERE id = :uid"), {"uid": user_id})

    print(f"Utente eliminato: {email} (id: {uid_str})")


if __name__ == "__main__":
    asyncio.run(main())
