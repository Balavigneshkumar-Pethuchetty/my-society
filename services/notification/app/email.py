"""Email sending via Gmail SMTP."""
import html
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import logging

from app.config import settings

logger = logging.getLogger(__name__)


def _build_message(subject: str, message: str) -> MIMEMultipart:
    """Build HTML email message."""
    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = f"Society Events <{settings.gmail_smtp_user}>"
    body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #6366f1;">{html.escape(subject)}</h2>
      <p style="white-space: pre-line;">{html.escape(message)}</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">Society Events</p>
    </div>
    """
    msg.attach(MIMEText(body, "html"))
    return msg


def send_notification_emails_sequential(
    recipients: list[tuple[str, str]], message: str
) -> list[tuple[str, str]]:
    """
    Send emails sequentially over one SMTP connection.

    Args:
        recipients: List of (email, subject) tuples
        message: Email body message

    Returns:
        List of (email, error) tuples for failed recipients
    """
    if not settings.gmail_smtp_user or not settings.gmail_app_password:
        return []

    failures: list[tuple[str, str]] = []
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as server:
            server.starttls()
            server.login(settings.gmail_smtp_user, settings.gmail_app_password)
            for to_email, subject in recipients:
                try:
                    msg = _build_message(subject, message)
                    msg["To"] = to_email
                    server.sendmail(settings.gmail_smtp_user, [to_email], msg.as_string())
                except Exception as exc:
                    error_msg = str(exc)[:200]
                    failures.append((to_email, error_msg))
                    logger.error(f"Failed to send email to {to_email}: {error_msg}")
    except Exception as exc:
        logger.error(f"SMTP connection error: {exc}", exc_info=True)
        # Mark all as failed if we can't even connect
        failures = [(email, str(exc)[:200]) for email, _ in recipients]

    return failures
