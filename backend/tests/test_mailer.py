"""Email delivery: Brevo's HTTP API (production), SMTP (local) or none. No real email is sent."""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.core.config import settings
from app.mailer import BREVO_SEND_URL, EmailDeliveryError, OutgoingEmail, email_backend, send_email
from tests.test_booking_api import send_booking_confirmation_email

EMAIL = OutgoingEmail(to="dana@example.com", subject="Booking confirmed (#42)", text="Plain #42", html="<p>#42</p>")


@pytest.fixture
def brevo(monkeypatch):
    """Configure Brevo and replace the HTTPS call with a fake that records the request."""
    monkeypatch.setattr(settings, "brevo_api_key", "test-key")
    monkeypatch.setattr(settings, "smtp_from_email", "shop@gmail.com")
    monkeypatch.setattr(settings, "email_reply_to", "")
    response = MagicMock(is_error=False, status_code=201, text='{"messageId": "<1@brevo>"}')
    with patch("app.mailer.httpx.post", return_value=response) as post:
        yield post


@pytest.mark.parametrize(
    ("brevo_key", "smtp_host", "expected"),
    [("key", "smtp.gmail.com", "brevo"), ("", "smtp.gmail.com", "smtp"), ("", "", "none")],
)
def test_backend_is_chosen_from_settings(brevo_key, smtp_host, expected, monkeypatch) -> None:
    monkeypatch.setattr(settings, "brevo_api_key", brevo_key)
    monkeypatch.setattr(settings, "smtp_host", smtp_host)
    assert email_backend() == expected


def test_brevo_request_has_the_right_url_key_and_content(brevo) -> None:
    assert send_email(EMAIL) == "brevo"

    brevo.assert_called_once()
    args, kwargs = brevo.call_args
    assert args[0] == BREVO_SEND_URL
    assert kwargs["headers"]["api-key"] == "test-key"
    assert kwargs["timeout"] == 15
    assert kwargs["json"] == {
        "sender": {"name": settings.shop_name, "email": "shop@gmail.com"},
        "to": [{"email": "dana@example.com"}],
        "replyTo": {"email": "shop@gmail.com"},
        "subject": "Booking confirmed (#42)",
        "htmlContent": "<p>#42</p>",
        "textContent": "Plain #42",
    }


def test_reply_to_can_be_set_separately(brevo, monkeypatch) -> None:
    monkeypatch.setattr(settings, "email_reply_to", "owner@example.com")
    send_email(EMAIL)
    assert brevo.call_args.kwargs["json"]["replyTo"] == {"email": "owner@example.com"}


def test_brevo_error_answer_raises_with_the_reason(brevo) -> None:
    brevo.return_value = MagicMock(is_error=True, status_code=401, text='{"code":"unauthorized","message":"Key not found"}')

    with pytest.raises(EmailDeliveryError, match="401.*Key not found"):
        send_email(EMAIL)


def test_brevo_unreachable_raises(brevo) -> None:
    brevo.side_effect = httpx.ConnectTimeout("timed out")

    with pytest.raises(EmailDeliveryError, match="Could not reach Brevo"):
        send_email(EMAIL)


def test_failed_email_never_breaks_the_booking_flow(brevo, caplog) -> None:
    """The confirmation is sent after the booking is saved; a failure is only logged."""
    brevo.return_value = MagicMock(is_error=True, status_code=500, text="Internal error")
    start = datetime(2030, 1, 8, 10, 0, tzinfo=ZoneInfo("Europe/Stockholm"))

    send_booking_confirmation_email(  # must not raise
        booking_id=42, customer_email="dana@example.com", barber_name="Mika", service_name="Classic Cut",
        starts_at=start, ends_at=start + timedelta(minutes=45), price="290.00",
    )

    assert "Failed to send booking confirmation #42" in caplog.text


def test_confirmation_email_content_goes_to_brevo(brevo) -> None:
    start = datetime(2030, 1, 8, 10, 0, tzinfo=ZoneInfo("Europe/Stockholm"))

    send_booking_confirmation_email(
        booking_id=42, customer_email="dana@example.com", barber_name="Mika", service_name="Classic Cut",
        starts_at=start, ends_at=start + timedelta(minutes=45), price="290.00",
    )

    sent = brevo.call_args.kwargs["json"]
    assert sent["subject"] == "Booking confirmed — Classic Cut (#42)"
    assert "Booking reference: #42" in sent["textContent"]
    assert "10:00–10:45" in sent["htmlContent"]


def test_smtp_message_has_shop_name_and_reply_to(monkeypatch) -> None:
    monkeypatch.setattr(settings, "brevo_api_key", "")
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_from_email", "shop@example.com")
    monkeypatch.setattr(settings, "email_reply_to", "owner@example.com")

    with patch("app.mailer.smtplib.SMTP") as smtp:
        assert send_email(EMAIL) == "smtp"

    message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
    assert message["From"] == f"{settings.shop_name} <shop@example.com>"
    assert message["Reply-To"] == "owner@example.com"
