from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/kiron"
    jwt_secret: str = "dev-secret-change-me"
    jwt_access_ttl_min: int = 30
    jwt_refresh_ttl_days: int = 14
    cors_origins: str = "http://localhost:8080,http://localhost:5173"

    # Public URL of the frontend, used to build the password reset link.
    app_base_url: str = "http://localhost:8080"

    # Where the files router writes uploaded bytes on disk.
    files_dir: str = "/var/lib/kiron/files"

    # Outgoing SMTP for password reset emails. If smtp_host is blank the
    # backend logs the reset link to stdout instead of trying to send (useful
    # in dev / before SMTP is configured).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_ssl: bool = False
    smtp_username: str = ""
    smtp_password: str = ""
    # Default uses the innomaxsol.com noreply mailbox. Override via SMTP_FROM
    # in the production env if you want a different sender. cPanel typically
    # expects the username to match the From address.
    smtp_from: str = "Kiron Work OS <noreply@innomaxsol.com>"

    password_reset_ttl_min: int = 60

    # SLA breach scheduler (see app/scheduler.py). Disable in tests by setting
    # SLA_CHECK_ENABLED=false in .env.
    sla_check_enabled: bool = True
    sla_check_interval_min: int = 15
    sla_warn_window_hours: int = 4

    # Credentials vault master key — base64(32 bytes). Stored only in
    # /etc/kiron/backend.env. If empty, vault encrypt/decrypt errors out
    # rather than persisting plaintext or a weak key. Generate via:
    #   python -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"
    vault_master_key: str = ""

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
