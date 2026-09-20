from urllib.parse import quote_plus
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_host: str = "postgres"
    db_port: int = 5432
    db_name: str = "society_events"
    db_user: str
    db_password: str

    keycloak_url: str = "https://auth.gm-global-techies-town.club"
    keycloak_realm: str = "society-events"
    keycloak_public_url: str = "https://auth.gm-global-techies-town.club"
    internal_api_key: str
    society_id: str = "11100000-0000-0000-0000-000000000001"
    # App's public URL — used to build a deep link into notification messages.
    app_public_url: str = "http://localhost:8080"

    user_service_internal_url: str = "http://user-service:3001/internal/users"

    splunk_hec_url: str = "http://splunk:8088/services/collector/event"
    splunk_hec_token: str = ""

    redis_host: str = "redis"
    redis_port: int = 6379
    redis_password: str = ""
    cache_ttl_seconds: int = 300

    # auth-service (~/auth-service) — shared SMS/Telegram transport, same
    # contract as registration-service's organizer notifications.
    auth_service_url: str = "http://host.containers.internal:8000"
    auth_service_api_key: str = ""

    # Gmail SMTP — shared credential with services/payment and services/registration,
    # used to email residents a copy of the event-details-changed broadcast.
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    gmail_smtp_user: str = ""
    gmail_app_password: str = ""
    smtp_from_name: str = "GM Global Techies Town"
    society_name: str = "GM Global Techies Town"

    # Novu notification orchestration service
    novu_api_key: str = ""
    novu_base_url: str = "http://novu-api:3000"
    notification_strategy: str = "novu_with_fallback"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql://{quote_plus(self.db_user)}:{quote_plus(self.db_password)}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def jwks_uri(self) -> str:
        return f"{self.keycloak_url}/realms/{self.keycloak_realm}/protocol/openid-connect/certs"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
