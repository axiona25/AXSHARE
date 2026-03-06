"""
Protezione brute-force su login (WebAuthn authenticate).
Dopo MAX_ATTEMPTS tentativi falliti in WINDOW_SECONDS, blocca IP/email per LOCKOUT_SECONDS.
"""

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 300   # 5 minuti
LOCKOUT_SECONDS = 900  # 15 minuti


class BruteForceService:
    @staticmethod
    def _key_ip(ip: str) -> str:
        return f"bf:ip:{ip}"

    @staticmethod
    def _key_email(email: str) -> str:
        return f"bf:email:{email.lower()}"

    @staticmethod
    async def record_failure(redis_client, ip: str, email: str) -> None:
        """Registra un tentativo di login fallito."""
        for key in [BruteForceService._key_ip(ip), BruteForceService._key_email(email)]:
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, WINDOW_SECONDS)
            if count >= MAX_ATTEMPTS:
                await redis_client.expire(key, LOCKOUT_SECONDS)

    @staticmethod
    async def is_locked(redis_client, ip: str, email: str) -> bool:
        """Controlla se IP o email sono in lockout."""
        count_ip = await redis_client.get(BruteForceService._key_ip(ip))
        count_email = await redis_client.get(BruteForceService._key_email(email))
        ip_count = int(count_ip) if count_ip else 0
        email_count = int(count_email) if count_email else 0
        return ip_count >= MAX_ATTEMPTS or email_count >= MAX_ATTEMPTS

    @staticmethod
    async def clear(redis_client, ip: str, email: str) -> None:
        """Cancella contatore dopo login OK."""
        await redis_client.delete(BruteForceService._key_ip(ip))
        await redis_client.delete(BruteForceService._key_email(email))

    @staticmethod
    async def get_remaining_attempts(redis_client, ip: str, email: str) -> int:
        count_ip = await redis_client.get(BruteForceService._key_ip(ip))
        count = int(count_ip) if count_ip else 0
        return max(0, MAX_ATTEMPTS - count)
