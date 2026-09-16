from urllib.parse import quote_plus
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Accept credentials separately so special chars in passwords are safe
    db_host: str = "postgres"
    db_port: int = 5432
    db_name: str = "society_events"
    db_user: str
    db_password: str

    keycloak_url: str = "https://auth.gm-global-techies-town.club"
    keycloak_realm: str = "society-events"
    # Externally reachable Keycloak URL (browser-side). Used for Swagger UI OAuth2 URLs.
    keycloak_public_url: str = "https://auth.gm-global-techies-town.club"
    # App's public URL — where users land after completing Keycloak actions (e.g. password reset)
    app_public_url: str = "http://localhost:8080"
    # Keycloak master-realm admin credentials for role assignment via Admin REST API
    keycloak_admin_user: str = "admin"
    keycloak_admin_password: str
    internal_api_key: str
    # Default society UUID matches seed data; override for multi-society later
    society_id: str = "11100000-0000-0000-0000-000000000001"

    event_service_internal_url: str = "http://event-service:3002/internal"
    ticket_service_internal_url: str = "http://ticket-service:3006/internal/tickets"
    society_name: str = "GM Global Techies Town"
    society_short_name: str = "GMGT"
    society_city: str = "Bengaluru"
    uploads_dir: str = "/app/uploads"
    minio_endpoint: str = "http://minio:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "uploads"
    # ~/auth-service's turnkey OTP request/verify API — used for phone verification
    # and phone-number login (POST /api/otp/request, /api/otp/verify). Shared
    # secret must match auth-service's OTP_SERVICE_API_KEY.
    auth_service_url: str = "http://host.containers.internal:8000"
    auth_service_api_key: str = ""
    # otp-bridge Keycloak service account — RFC 8693 token exchange to mint a
    # real Keycloak access token for a phone-OTP-verified user, without
    # touching their password. Requires Keycloak's --features=token-exchange
    # and the service account's `impersonation` realm-management role.
    otp_bridge_client_id: str = "otp-bridge"
    otp_bridge_client_secret: str = ""

    # Gmail SMTP — shared credential with services/payment and services/registration,
    # used to email admins about leave-society events (request submitted / finalized).
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    gmail_smtp_user: str = ""
    gmail_app_password: str = ""
    smtp_from_name: str = "GM Global Techies Town"

    # PII encryption at rest (users.phone/users.email — see PII_PRIVACY_PLAN.md).
    # Two independent keys so a leak of one doesn't also break/expose the other:
    # pii_encryption_key is base64 for exactly 32 raw bytes (AES-256-GCM), e.g.
    # generated with `python -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"`;
    # pii_hash_key is an arbitrary secret string for the HMAC-SHA256 blind index.
    # Never reuse either for anything else (JWT signing, internal_api_key, etc.).
    # No default — required, same as db_password/internal_api_key: fail fast at
    # startup if unset rather than silently at first phone/email access.
    pii_encryption_key: str
    pii_hash_key: str

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
