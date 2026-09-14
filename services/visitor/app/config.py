from urllib.parse import quote_plus
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_host: str = "visitor-postgres"
    db_port: int = 5432
    db_name: str = "visitor_service"
    db_user: str
    db_password: str

    keycloak_url: str = "https://auth.gm-global-techies-town.club"
    keycloak_realm: str = "society-events"
    keycloak_public_url: str = "https://auth.gm-global-techies-town.club"
    internal_api_key: str
    society_id: str = "11100000-0000-0000-0000-000000000001"
    society_name: str = "GM Global Techies Town"

    user_service_internal_url: str = "http://user-service:3001/internal/users"
    auth_service_url: str = "http://host.containers.internal:8000"
    auth_service_api_key: str = ""

    uploads_dir: str = "/app/uploads"
    minio_endpoint: str = "http://minio:9000"
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = "uploads"
    overdue_threshold_minutes_default: int = 60

    splunk_hec_url: str = "http://splunk:8088/services/collector/event"
    splunk_hec_token: str = ""

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
