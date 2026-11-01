from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    jwt_secret: str
    fernet_key: str
    admin_email: str
    admin_password: str
    public_base_url: str = "http://localhost:8000"
    contact_email: str = ""            # shown on /terms and /privacy; defaults to ADMIN_EMAIL
    debug: bool = False
    retention_days: int = 90           # chats older than this are deleted automatically
    sentry_dsn: str = ""               # optional error tracking

    # Where the real visitor IP comes from. On Render set CLIENT_IP_HEADER=true-client-ip.
    # Otherwise the Nth entry from the right of X-Forwarded-For is used (PROXY_HOPS=1: rightmost).
    client_ip_header: str = ""
    proxy_hops: int = 1

    voyage_api_key: str = ""
    voyage_model: str = "voyage-3.5-lite"  # must output 1024 dims (voyage-4-lite also works)
    tavily_api_key: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    groq_api_key: str = ""
    openrouter_api_key: str = ""
    xai_api_key: str = ""

    @model_validator(mode="after")
    def _safety(self):
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        if len(self.admin_password) < 12 or "change-this" in self.admin_password.lower():
            raise ValueError("ADMIN_PASSWORD must be at least 12 characters and not the example value")
        return self


settings = Settings()
