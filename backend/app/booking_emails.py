"""The emails customers receive about a booking: confirmation and cancellation.

Both are sent as FastAPI background tasks after the database change is saved,
so a slow or failing email provider never blocks or undoes a booking.
"""

from __future__ import annotations

import html
import logging
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from app.core.config import settings
from app.mailer import EmailDeliveryError, OutgoingEmail, email_backend, send_email
from app.schedule import STOCKHOLM_TZ

logger = logging.getLogger(__name__)


def format_price_kr(value: str | int | float | Decimal) -> str:
    price = Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return f"{int(price)} kr"


def format_booking_time_range(starts_at: datetime, ends_at: datetime) -> str:
    stockholm_start = starts_at.astimezone(STOCKHOLM_TZ)
    stockholm_end = ends_at.astimezone(STOCKHOLM_TZ)
    return f"{stockholm_start.strftime('%H:%M')}–{stockholm_end.strftime('%H:%M')}"


def _details(booking_id: int, barber_name: str, service_name: str, starts_at: datetime, ends_at: datetime,
             price: str | None) -> list[tuple[str, str]]:
    rows = [
        ("Service", service_name),
        ("Barber", barber_name),
        ("Date", starts_at.astimezone(STOCKHOLM_TZ).strftime("%A %d %B %Y")),
        ("Time", format_booking_time_range(starts_at, ends_at)),
    ]
    if price is not None:
        rows.append(("Price", format_price_kr(price)))
    rows += [("Address", settings.shop_address), ("Booking reference", f"#{booking_id}")]
    return rows


def _html(intro: str, rows: list[tuple[str, str]], note: str, button: tuple[str, str] | None = None) -> str:
    """Shared email layout. Every inserted value is HTML-escaped, so a name
    containing < or & can't break the email."""
    e = html.escape
    shop = e(settings.shop_name)
    row_html = "".join(
        f"""
                      <tr>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb;"><strong>{e(label)}</strong></td>
                        <td style="padding:10px 0; border-bottom:1px solid #e5e7eb; text-align:right;">{e(value)}</td>
                      </tr>"""
        for label, value in rows
    )
    button_html = ""
    if button:
        label, url = button
        button_html = f"""
                    <p style="margin:0 0 24px;">
                      <a href="{e(url, quote=True)}" style="display:inline-block; background-color:#1f2937; color:#ffffff; text-decoration:none; padding:12px 20px; border-radius:10px; font-weight:bold;">{e(label)}</a>
                    </p>"""
    return f"""
    <html>
      <body style="margin:0; padding:0; background-color:#f5f1eb; font-family:Arial, sans-serif; color:#1f2937;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f1eb; padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background-color:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e5e7eb;">
                <tr>
                  <td style="background-color:#1f2937; padding:24px 32px; color:#ffffff;">
                    <div style="font-size:28px; font-weight:bold; letter-spacing:0.04em;">{shop}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px;">
                    <p style="margin:0 0 16px; font-size:16px;">Hi there,</p>
                    <p style="margin:0 0 24px; font-size:16px; line-height:1.6;">{e(intro)}</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin:0 0 24px;">{row_html}
                    </table>{button_html}
                    <p style="margin:0; font-size:14px; color:#4b5563;">{e(note)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="background-color:#faf7f4; padding:20px 32px; color:#374151; font-size:14px; border-top:1px solid #e5e7eb;">
                    {shop} • {e(settings.shop_address)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    """


def _text(intro: str, rows: list[tuple[str, str]], extra: list[str]) -> str:
    return "\n".join(
        ["Hi there,", "", intro, "", *(f"{label}: {value}" for label, value in rows), "", *extra, settings.shop_name]
    )


def _deliver(email: OutgoingEmail, kind: str, booking_id: int) -> None:
    try:
        backend = send_email(email)
        logger.info("Sent booking %s #%s via %s", kind, booking_id, backend)
    except EmailDeliveryError:
        # The database change is already saved; a failed email must not undo it.
        logger.exception("Failed to send booking %s #%s to %s", kind, booking_id, email.to)


def send_booking_confirmation_email(
    booking_id: int,
    customer_email: str,
    barber_name: str,
    service_name: str,
    starts_at: datetime,
    ends_at: datetime,
    price: str,
    manage_url: str | None = None,
) -> None:
    # Email is optional: with no email backend configured, bookings work without it.
    if not customer_email or email_backend() == "none":
        return

    rows = _details(booking_id, barber_name, service_name, starts_at, ends_at, price)
    intro = "Your booking has been confirmed. We’re looking forward to welcoming you."
    if manage_url:
        note = (
            f"Need to cancel? Use the button above until {settings.customer_cancel_cutoff_hours} hours "
            "before your appointment, or contact us directly."
        )
        extra = [f"Manage or cancel your booking: {manage_url}", "", "We look forward to seeing you."]
        button = ("Manage or cancel booking", manage_url)
    else:
        note = "If you need to change your booking, please contact us directly."
        extra = ["We look forward to seeing you."]
        button = None

    _deliver(
        OutgoingEmail(
            to=customer_email,
            subject=f"Booking confirmed — {service_name} (#{booking_id})",
            text=_text(f"Your booking at {settings.shop_name} has been confirmed.", rows, extra),
            html=_html(intro, rows, note, button),
        ),
        "confirmation",
        booking_id,
    )


def send_booking_cancelled_email(
    booking_id: int,
    customer_email: str,
    barber_name: str,
    service_name: str,
    starts_at: datetime,
    ends_at: datetime,
) -> None:
    if not customer_email or email_backend() == "none":
        return

    rows = _details(booking_id, barber_name, service_name, starts_at, ends_at, price=None)
    book_again = f"Want a new time? Book again at {settings.public_site_url}"
    _deliver(
        OutgoingEmail(
            to=customer_email,
            subject=f"Booking cancelled — {service_name} (#{booking_id})",
            text=_text(f"Your booking at {settings.shop_name} has been cancelled.", rows, [book_again, ""]),
            html=_html(
                "Your booking has been cancelled. The time is now free for someone else.",
                rows,
                "Hope to see you another time.",
                ("Book a new time", settings.public_site_url),
            ),
        ),
        "cancellation",
        booking_id,
    )
