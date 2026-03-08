"""
Verifica che un utente abbia chiave pubblica e privata cifrata (setup PIN ok).
Uso: python -m scripts.check_user_keys [email o nome]
Es: python -m scripts.check_user_keys raffaele
     python -m scripts.check_user_keys r.amoroso80@gmail.com
"""
import asyncio
import sys
from sqlalchemy import select, or_
from app.database import engine
from app.models.user import User


async def main():
    search = (sys.argv[1] if len(sys.argv) > 1 else "").strip().lower()
    from sqlalchemy import text

    async with engine.begin() as conn:
        if search:
            q = text("""
                SELECT id, email, display_name_encrypted,
                       public_key_rsa IS NOT NULL AND length(public_key_rsa) > 0 AS has_public_key,
                       private_key_encrypted IS NOT NULL AND length(private_key_encrypted) > 0 AS has_private_encrypted,
                       is_active, created_at
                FROM axshare.users
                WHERE lower(email) LIKE :pat OR lower(display_name_encrypted) LIKE :pat
                ORDER BY created_at DESC
            """)
            result = await conn.execute(q, {"pat": f"%{search}%"})
        else:
            q = text("""
                SELECT id, email, display_name_encrypted,
                       public_key_rsa IS NOT NULL AND length(public_key_rsa) > 0 AS has_public_key,
                       private_key_encrypted IS NOT NULL AND length(private_key_encrypted) > 0 AS has_private_encrypted,
                       is_active, created_at
                FROM axshare.users
                ORDER BY created_at DESC
                LIMIT 10
            """)
            result = await conn.execute(q)
        rows = result.fetchall()

    if not rows:
        print(f"Nessun utente trovato" + (f" per: {search}" if search else "."))
        sys.exit(1)

    for row in rows:
        uid, email, display_name, has_pub, has_priv, active, created = row
        ok = has_pub and has_priv and active
        status = "OK" if ok else "MANCANTE"
        print(f"--- Utente: {display_name} ({email}) ---")
        print(f"  ID: {uid}")
        print(f"  Chiave pubblica: {'sì' if has_pub else 'NO'}")
        print(f"  Chiave privata cifrata (PIN): {'sì' if has_priv else 'NO'}")
        print(f"  Attivo: {'sì' if active else 'no'}")
        print(f"  Creato: {created}")
        print(f"  Stato: {status}")
        if not ok:
            if not has_pub:
                print("  → Manca chiave pubblica: l'utente deve completare Configura PIN / setup chiavi.")
            if not has_priv:
                print("  → Manca chiave privata cifrata: l'utente deve completare setup con PIN.")
        print()


if __name__ == "__main__":
    asyncio.run(main())
