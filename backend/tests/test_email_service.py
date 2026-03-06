"""Test rendering e invio email (EmailService)."""

import pytest


@pytest.fixture(autouse=True)
def set_log_provider(monkeypatch):
    monkeypatch.setenv("EMAIL_PROVIDER", "log")
    from app.config import get_settings

    get_settings.cache_clear()


def test_render_guest_invite_template():
    """Template guest_invite si renderizza senza errori."""
    from app.services.email_service import EmailService

    subject, html = EmailService._render(
        "guest_invite.html",
        {
            "invite_url": "https://app.axshare.io/invite/TOKEN",
            "owner_email": "owner@test.com",
            "file_count": 3,
            "expires_in_hours": 24,
            "unsubscribe_url": "https://app.axshare.io/unsubscribe?token=x",
        },
    )
    assert "owner@test.com" in html
    assert "invite/TOKEN" in html
    assert "24 ore" in html


def test_render_erasure_template():
    """Template erasure_confirmed si renderizza."""
    from app.services.email_service import EmailService

    subject, html = EmailService._render(
        "erasure_confirmed.html",
        {
            "request_id": "req-123",
            "requested_at": "2026-03-05T10:00:00Z",
            "unsubscribe_url": "",
        },
    )
    assert "req-123" in html
    assert "GDPR" in html or "Art. 17" in html


def test_render_security_alert():
    """Template security_alert si renderizza."""
    from app.services.email_service import EmailService

    subject, html = EmailService._render(
        "security_alert.html",
        {
            "alert_type": "Accesso da nuovo IP",
            "message": "Login da 1.2.3.4",
            "details": {"IP": "1.2.3.4", "Browser": "Chrome"},
            "unsubscribe_url": "",
        },
    )
    assert "1.2.3.4" in html


@pytest.mark.asyncio
async def test_send_with_log_provider():
    """Provider log non solleva eccezioni e ritorna True."""
    from app.services.email_service import EmailService

    result = await EmailService.send_guest_invite(
        guest_email="guest@test.com",
        invite_url="https://test/invite/TOKEN",
        owner_email="owner@test.com",
        expires_in_hours=24,
    )
    assert result is True


def test_unsubscribe_token_is_deterministic():
    """Token unsubscribe è deterministico."""
    from app.services.email_service import EmailService

    t1 = EmailService._generate_unsubscribe_token("a@b.com", "guest_invite")
    t2 = EmailService._generate_unsubscribe_token("a@b.com", "guest_invite")
    assert t1 == t2
    t3 = EmailService._generate_unsubscribe_token("a@b.com", "other_type")
    assert t1 != t3
