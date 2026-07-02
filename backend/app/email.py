"""Outgoing email transport (currently used for password reset).

If `SMTP_HOST` is configured the message is sent via stdlib `smtplib` over
SSL or STARTTLS. If `SMTP_HOST` is empty, the message is logged to stdout —
that keeps the password-reset flow usable in dev / before SMTP is wired up,
since the developer can copy the link out of the server log.

This module is intentionally tiny and synchronous; FastAPI runs it inside a
threadpool when invoked from a sync handler.
"""
import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from .config import settings

log = logging.getLogger("kiron.email")


def _build_from_header(from_name_override: str | None) -> str:
    """Return the From header value.

    Default: settings.smtp_from verbatim (e.g. "Kiron Work OS <noreply@...>").
    With override: replaces just the display-name portion so the mailbox
    stays constant (SPF/DKIM/DMARC on `noreply@` domain), but the row in
    Gmail reads as the applicant's name.
    """
    if not from_name_override:
        return settings.smtp_from
    name, addr = parseaddr(settings.smtp_from)
    if not addr:
        # smtp_from wasn't a proper address form — fall back to override.
        return from_name_override
    return formataddr((from_name_override, addr))


def send_email(
    to: str,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    *,
    reply_to: str | None = None,
    from_name_override: str | None = None,
) -> None:
    """Send a plaintext (and optional HTML) email to a single recipient.

    Optional kwargs:
      - reply_to: sets the Reply-To header so hitting Reply in a client
        goes to a different mailbox than the shared sender.
      - from_name_override: swaps the display-name portion of the From
        header (mailbox address is preserved).
    """
    if not settings.smtp_host:
        log.warning(
            "[email] SMTP not configured — would send:\n  to=%s\n  subject=%s\n%s",
            to, subject, body_text,
        )
        return

    msg = EmailMessage()
    msg["From"] = _build_from_header(from_name_override)
    msg["To"] = to
    if reply_to:
        msg["Reply-To"] = reply_to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    if settings.smtp_ssl:
        smtp = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15)
    else:
        smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
        smtp.ehlo()
        try:
            smtp.starttls()
            smtp.ehlo()
        except smtplib.SMTPException:
            # Some local relays don't support STARTTLS; that's acceptable in
            # a trusted internal network (cPanel typically uses SSL on 465).
            pass

    try:
        if settings.smtp_username and settings.smtp_password:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)
        log.info(
            "[email] sent to=%s subject=%s reply_to=%s",
            to, subject, reply_to or "-",
        )
    finally:
        try:
            smtp.quit()
        except Exception:  # noqa: BLE001
            pass


def send_password_reset(email: str, full_name: str, reset_url: str) -> None:
    """Compose the password reset email."""
    subject = "Reset your Kiron Work OS password"
    body_text = (
        f"Hi {full_name or 'there'},\n\n"
        f"Someone — hopefully you — asked to reset the password for your Kiron Work OS account.\n"
        f"To choose a new password, follow this link within the next "
        f"{settings.password_reset_ttl_min} minutes:\n\n"
        f"  {reset_url}\n\n"
        f"If you didn't request this, you can safely ignore this email — your password won't change.\n\n"
        f"— Kiron Work OS"
    )
    body_html = (
        f"<p>Hi {full_name or 'there'},</p>"
        f"<p>Someone — hopefully you — asked to reset the password for your "
        f"Kiron Work OS account.</p>"
        f'<p><a href="{reset_url}" '
        f'style="display:inline-block;padding:10px 16px;background:#0f172a;'
        f'color:#fff;text-decoration:none;border-radius:6px">Choose a new password</a></p>'
        f"<p>This link expires in {settings.password_reset_ttl_min} minutes.</p>"
        f"<p style='color:#666;font-size:12px'>If you didn't request this, you can safely "
        f"ignore the email — your password won't change.</p>"
    )
    send_email(email, subject, body_text, body_html)
