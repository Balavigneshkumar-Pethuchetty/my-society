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

    event_service_internal_url: str = "http://event-service:3002/internal"
    user_service_internal_url: str = "http://user-service:3001/internal/users"

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
