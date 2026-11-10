"""Transactional email through Brevo's HTTPS API. Plain SMTP is blocked on free hosting tiers (Render blocks ports 25/465/587)."""
import logging

import httpx

from .config import settings

log = logging.getLogger("email")
_client = httpx.AsyncClient(timeout=15)


class EmailError(Exception):
    pass


def enabled() -> bool:
    return bool(settings.brevo_api_key and settings.email_from)


def available() -> bool:
    """Can mail go out? In debug mode, emails are written to the log instead, so local development needs no account."""
    return enabled() or settings.debug


async def send(to: str, subject: str, text: str) -> None:
    if not enabled():
        if settings.debug:
            log.warning("EMAIL (debug, not sent) to=%s subject=%s\n%s", to, subject, text)
            return
        raise EmailError("Email is not configured on this server")
    try:
        r = await _client.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": settings.brevo_api_key, "accept": "application/json"},
            json={"sender": {"name": settings.email_from_name, "email": settings.email_from},
                  "to": [{"email": to}], "subject": subject, "textContent": text},
        )
    except httpx.HTTPError as e:
        raise EmailError(f"Could not reach the email service: {type(e).__name__}") from None
    if r.status_code >= 300:
        raise EmailError(f"The email service returned {r.status_code}: {r.text[:200]}")


def mask(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


async def notify(to: str, subject: str, text: str) -> None:
    """Best-effort security notice: never blocks or fails the request that triggered it."""
    try:
        await send(to, subject, text)
    except EmailError:
        log.warning("could not send notification '%s'", subject)
