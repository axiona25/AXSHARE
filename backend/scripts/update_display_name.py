"""
Imposta il nome visualizzato (display_name) di un utente per email.
Uso (dalla cartella backend o con docker):
  python -m scripts.update_display_name <email> "Nome Cognome"
  docker compose exec backend python -m scripts.update_display_name r.amoroso80@gmail.com "Raffaele Amoroso"
"""
import asyncio
import sys

from sqlalchemy import text, select
from app.database import engine
from app.models.user import User


async def main():
    if len(sys.argv) < 3:
        print('Uso: python -m scripts.update_display_name <email> "Nome Cognome"')
        sys.exit(1)
    email = sys.argv[1].strip()
    display_name = " ".join(sys.argv[2:]).strip()
    if not email:
        print("Fornire un'email valida.")
        sys.exit(1)
    if not display_name:
        print("Fornire un nome visualizzato (es. \"Raffaele Amoroso\").")
        sys.exit(1)

    async with engine.begin() as conn:
        result = await conn.execute(select(User.id).where(User.email == email))
        row = result.fetchone()
        if not row:
            print(f"Nessun utente trovato con email: {email}")
            sys.exit(1)
        user_id = row[0]
        await conn.execute(
            text("UPDATE axshare.users SET display_name_encrypted = :name WHERE id = :uid"),
            {"name": display_name, "uid": user_id},
        )
    print(f"display_name aggiornato per {email} → \"{display_name}\". Ricarica la pagina per vedere il nuovo nome.")


if __name__ == "__main__":
    asyncio.run(main())
