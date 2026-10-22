"""Sending email: Brevo's HTTP API in production, SMTP locally, or nothing.

Render's free tier blocks outgoing SMTP ports (25/465/587), so in production
emails go over HTTPS (port 443) to Brevo's transactional email API instead.
Callers build the message and call send_email(); which way it's delivered is
decided here from the settings:

    BREVO_API_KEY set  -> Brevo API
    SMTP_HOST set      -> SMTP (e.g. Gmail or Mailpit on a laptop)
    neither            -> not sent (bookings work without email)
"""

from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email"
TIMEOUT_SECONDS = 15


class EmailDeliveryError(Exception):
    """The email provider refused or couldn't be reached."""


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    text: str
    html: str


def email_backend() -> str:
    if settings.brevo_api_key:
        return "brevo"
    if settings.smtp_host:
        return "smtp"
    return "none"


def send_email(email: OutgoingEmail) -> str:
    """Send the email with the configured backend. Returns the backend used.

    Raises EmailDeliveryError if the provider fails, so the caller decides
    whether that matters (a booking is never undone because an email failed).
    """
    backend = email_backend()
    if backend == "brevo":
        _send_via_brevo(email)
    elif backend == "smtp":
        _send_via_smtp(email)
    return backend


def _reply_to() -> str:
    return settings.email_reply_to or settings.smtp_from_email


def _send_via_brevo(email: OutgoingEmail) -> None:
    payload = {
        "sender": {"name": settings.shop_name, "email": settings.smtp_from_email},
        "to": [{"email": email.to}],
        # Replies reach the shop even if Brevo rewrites the sender address
        # (it does for unauthenticated free domains such as gmail.com).
        "replyTo": {"email": _reply_to()},
        "subject": email.subject,
        "htmlContent": email.html,
        "textContent": email.text,
    }
    try:
        response = httpx.post(
            BREVO_SEND_URL,
            json=payload,
            headers={"api-key": settings.brevo_api_key, "accept": "application/json"},
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise EmailDeliveryError(f"Could not reach Brevo: {exc.__class__.__name__}") from exc

    if response.is_error:
        # Brevo explains the problem in the body, e.g. {"code": "unauthorized", ...}.
        # The API key is only in the request headers, so it never ends up in the log.
        raise EmailDeliveryError(f"Brevo answered {response.status_code}: {response.text[:300]}")


def _send_via_smtp(email: OutgoingEmail) -> None:
    message = EmailMessage()
    message["Subject"] = email.subject
    message["From"] = formataddr((settings.shop_name, settings.smtp_from_email))
    message["To"] = email.to
    message["Reply-To"] = _reply_to()
    message.set_content(email.text)
    message.add_alternative(email.html, subtype="html")

    try:
        # Timeout so an unreachable mail server (or a host that blocks SMTP ports)
        # fails within seconds instead of hanging the background task for minutes.
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=TIMEOUT_SECONDS) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise EmailDeliveryError(f"SMTP failed: {exc.__class__.__name__}: {exc}") from exc
