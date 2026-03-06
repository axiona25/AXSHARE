"""
Servizio email AXSHARE.
Provider supportati: resend, smtp, log (solo logging — per dev/test).
"""

import re
import logging
import hmac
import hashlib
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader, select_autoescape
from premailer import transform

from app.config import get_settings

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "email" / "templates"


class EmailService:
    _env: Optional[Environment] = None

    @classmethod
    def _get_jinja_env(cls) -> Environment:
        if cls._env is None:
            cls._env = Environment(
                loader=FileSystemLoader(str(TEMPLATES_DIR)),
                autoescape=select_autoescape(["html"]),
            )
        return cls._env

    @classmethod
    def _render(cls, template_name: str, context: dict) -> tuple[str, str]:
        """Ritorna (subject, html_body). Estrae subject dal <title> del template."""
        env = cls._get_jinja_env()
        tpl = env.get_template(template_name)
        context.setdefault("year", datetime.now().year)
        html = tpl.render(**context)
        html_inlined = transform(html)
        match = re.search(r"<title>([^<]*)</title>", html_inlined, re.IGNORECASE | re.DOTALL)
        subject = match.group(1).strip() if match else "AXSHARE"
        return subject, html_inlined

    @classmethod
    def _generate_unsubscribe_token(cls, email: str, email_type: str) -> str:
        settings = get_settings()
        raw = f"{email}:{email_type}:{settings.email_unsubscribe_secret}"
        return (
            hmac.new(
                settings.email_unsubscribe_secret.encode(),
                raw.encode(),
                hashlib.sha256,
            ).hexdigest()[:32]
        )

    @classmethod
    def _unsubscribe_url(cls, email: str, email_type: str) -> str:
        settings = get_settings()
        token = cls._generate_unsubscribe_token(email, email_type)
        return (
            f"{settings.frontend_url}/unsubscribe"
            f"?email={email}&type={email_type}&token={token}"
        )

    @classmethod
    async def send(
        cls,
        to: str,
        template: str,
        context: dict,
        email_type: str = "notification",
    ) -> bool:
        """
        Invia email usando il provider configurato.
        Ritorna True se inviata, False in caso di errore.
        """
        settings = get_settings()
        context = dict(context)
        context["unsubscribe_url"] = cls._unsubscribe_url(to, email_type)

        try:
            subject, html_body = cls._render(template, context)
        except Exception as e:
            logger.error("Email render error (%s): %s", template, e)
            return False

        provider = settings.email_provider

        if provider == "resend":
            return await cls._send_resend(to, subject, html_body, settings)
        if provider == "smtp":
            return cls._send_smtp(to, subject, html_body, settings)
        logger.info(
            "[EMAIL LOG] To: %s | Subject: %s | Template: %s | Context keys: %s",
            to,
            subject,
            template,
            list(context.keys()),
        )
        return True

    @classmethod
    async def _send_resend(cls, to: str, subject: str, html_body: str, settings) -> bool:
        try:
            import resend

            resend.api_key = settings.resend_api_key or ""
            resend.Emails.send(
                {
                    "from": f"{settings.email_from_name} <{settings.email_from_address}>",
                    "to": [to],
                    "subject": subject,
                    "html": html_body,
                }
            )
            logger.info("Email inviata via Resend a %s: %s", to, subject)
            return True
        except Exception as e:
            logger.error("Resend error: %s", e)
            return cls._send_smtp(to, subject, html_body, settings)

    @classmethod
    def _send_smtp(cls, to: str, subject: str, html_body: str, settings) -> bool:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{settings.email_from_name} <{settings.email_from_address}>"
            msg["To"] = to
            msg.attach(MIMEText(html_body, "html", "utf-8"))

            if settings.smtp_tls:
                server = smtplib.SMTP(settings.smtp_host, settings.smtp_port)
                server.starttls()
            else:
                server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port)

            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password or "")

            server.sendmail(settings.email_from_address, [to], msg.as_string())
            server.quit()
            logger.info("Email inviata via SMTP a %s: %s", to, subject)
            return True
        except Exception as e:
            logger.error("SMTP error: %s", e)
            return False

    @classmethod
    async def send_guest_invite(
        cls,
        guest_email: str,
        invite_url: str,
        owner_email: str,
        file_count: int = 1,
        expires_in_hours: Optional[int] = None,
    ) -> bool:
        return await cls.send(
            to=guest_email,
            template="guest_invite.html",
            context={
                "invite_url": invite_url,
                "owner_email": owner_email,
                "file_count": file_count,
                "expires_in_hours": expires_in_hours,
            },
            email_type="guest_invite",
        )

    @classmethod
    async def send_share_link(
        cls,
        to_email: str,
        share_url: str,
        owner_email: str,
        label: Optional[str] = None,
        is_password_protected: bool = False,
        expires_at: Optional[str] = None,
    ) -> bool:
        return await cls.send(
            to=to_email,
            template="share_link.html",
            context={
                "share_url": share_url,
                "owner_email": owner_email,
                "label": label,
                "is_password_protected": is_password_protected,
                "expires_at": expires_at,
            },
            email_type="share_link",
        )

    @classmethod
    async def send_permission_expiring(
        cls,
        to_email: str,
        hours_remaining: int,
    ) -> bool:
        return await cls.send(
            to=to_email,
            template="permission_expiring.html",
            context={"hours_remaining": hours_remaining},
            email_type="permission_expiring",
        )

    @classmethod
    async def send_erasure_confirmed(
        cls,
        to_email: str,
        request_id: str,
        requested_at: str,
    ) -> bool:
        return await cls.send(
            to=to_email,
            template="erasure_confirmed.html",
            context={
                "request_id": request_id,
                "requested_at": requested_at,
            },
            email_type="erasure_confirmed",
        )

    @classmethod
    async def send_security_alert(
        cls,
        to_email: str,
        alert_type: str,
        message: str,
        details: Optional[dict] = None,
    ) -> bool:
        return await cls.send(
            to=to_email,
            template="security_alert.html",
            context={
                "alert_type": alert_type,
                "message": message,
                "details": details or {},
            },
            email_type="security_alert",
        )
