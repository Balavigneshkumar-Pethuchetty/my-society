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
    # App's public URL — used to build deep links into notification messages
    # (e.g. straight to the payment approval / refund queue for a given registration).
    app_public_url: str = "http://localhost:8080"

    event_service_internal_url: str = "http://event-service:3002/internal"
    user_service_internal_url: str = "http://user-service:3001/internal/users"
    ticket_service_internal_url: str = "http://ticket-service:3006/internal/tickets"

    splunk_hec_url: str = "http://splunk:8088/services/collector/event"
    splunk_hec_token: str = ""

    # auth-service (~/auth-service) — shared SMS/Telegram transport for
    # notifying event organizers, same contract as user-service's OTP calls.
    auth_service_url: str = "http://host.containers.internal:8000"
    auth_service_api_key: str = ""

    society_upi_id: str = ""
    society_upi_name: str = ""
    society_bank_name: str = ""
    society_bank_account: str = ""
    society_bank_ifsc: str = ""
    society_bank_beneficiary: str = ""
    uploads_dir: str = "/app/uploads"
    minio_endpoint: str = "http://minio:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "uploads"

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    gmail_smtp_user: str = ""
    gmail_app_password: str = ""
    smtp_from_name: str = "GM Global Techies Town"
    society_name: str = "GM Global Techies Town"

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
