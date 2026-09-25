"""Notification Service Configuration."""
import os
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Notification service settings."""

    environment: str = os.getenv("ENVIRONMENT", "development")
    debug: bool = environment == "development"

    # Service
    service_name: str = "notification-service"
    service_port: int = int(os.getenv("SERVICE_PORT", "3008"))

    # Database
    db_host: str = os.getenv("DB_HOST", "pgbouncer")
    db_port: int = int(os.getenv("DB_PORT", "6432"))
    db_name: str = os.getenv("DB_NAME", "society_events")
    db_user: str = os.getenv("DB_USER", "postgres")
    db_password: str = os.getenv("DB_PASSWORD", "")
    db_pool_size: int = int(os.getenv("DB_POOL_SIZE", "5"))

    # Novu Configuration
    novu_api_key: str = os.getenv("NOVU_API_KEY", "")
    novu_backend_url: str = os.getenv("NOVU_BACKEND_URL", "https://api.novu.co")
    novu_strategy: str = os.getenv("NOVU_STRATEGY", "NOVU_WITH_FALLBACK")  # NOVU_ONLY, NOVU_WITH_FALLBACK, FALLBACK_ONLY

    # Fallback Channels Configuration
    auth_service_url: str = os.getenv("AUTH_SERVICE_URL", "http://host.containers.internal:8000")
    auth_service_api_key: str = os.getenv("AUTH_SERVICE_API_KEY", "")

    # Email (Gmail SMTP)
    gmail_smtp_user: str = os.getenv("GMAIL_SMTP_USER", "")
    gmail_app_password: str = os.getenv("GMAIL_APP_PASSWORD", "")

    # Splunk Logging
    splunk_hec_url: Optional[str] = os.getenv("SPLUNK_HEC_URL")
    splunk_hec_token: Optional[str] = os.getenv("SPLUNK_HEC_TOKEN")

    # Society Configuration
    society_id: str = os.getenv("SOCIETY_ID", "11100000-0000-0000-0000-000000000001")

    # Keycloak
    keycloak_url: str = os.getenv("KEYCLOAK_URL", "https://auth.gm-global-techies-town.club")
    keycloak_realm: str = os.getenv("KEYCLOAK_REALM", "society-events")
    keycloak_public_url: Optional[str] = os.getenv("KEYCLOAK_PUBLIC_URL")

    # Internal Service Communication
    internal_api_key: str = os.getenv("INTERNAL_API_KEY", "")
    user_service_url: str = os.getenv("USER_SERVICE_URL", "http://user-service:3001")

    # Async Task Processing (optional)
    use_background_tasks: bool = os.getenv("USE_BACKGROUND_TASKS", "true").lower() == "true"

    # Optional Notification Service Configuration
    enable_notifications: bool = os.getenv("ENABLE_NOTIFICATIONS", "true").lower() == "true"
    notification_queue_type: str = os.getenv("NOTIFICATION_QUEUE_TYPE", "redis")

    # Redis Configuration
    redis_host: str = os.getenv("REDIS_HOST", "redis")
    redis_port: int = int(os.getenv("REDIS_PORT", "6379"))
    redis_db: int = int(os.getenv("REDIS_DB", "0"))

    # Notification Channels Configuration
    notification_channels: str = os.getenv("NOTIFICATION_CHANNELS", "email,novu")
    email_enabled: bool = os.getenv("EMAIL_ENABLED", "true").lower() == "true"
    sms_enabled: bool = os.getenv("SMS_ENABLED", "false").lower() == "true"
    telegram_enabled: bool = os.getenv("TELEGRAM_ENABLED", "false").lower() == "true"

    # SMS Provider (twilio or aws-sns)
    sms_provider: str = os.getenv("SMS_PROVIDER", "twilio")
    twilio_account_sid: Optional[str] = os.getenv("TWILIO_ACCOUNT_SID")
    twilio_auth_token: Optional[str] = os.getenv("TWILIO_AUTH_TOKEN")

    # Telegram
    telegram_bot_token: Optional[str] = os.getenv("TELEGRAM_BOT_TOKEN")

    # Retry Configuration
    notification_max_retries: int = int(os.getenv("NOTIFICATION_MAX_RETRIES", "5"))
    notification_retry_backoff_seconds: int = int(os.getenv("NOTIFICATION_RETRY_BACKOFF_SECONDS", "60"))

    class Config:
        env_file = ".env"


settings = Settings()
