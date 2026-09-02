from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./psv.db"
    jwt_secret: str = "development-secret"
    internal_service_token: str = ""
    psv_db_schema: str = "psv_db"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    gnn_service_url: str = "http://knowledge-gnn:3013"
    gnn_trainer_url: str = "http://knowledge-gnn-trainer:3016"
    kg_service_url: str = "http://kg:3012"
    decision_service_url: str = "http://decisions:3014"
    gnn_timeout_seconds: float = 2.0
    daily_refresh_enabled: bool = False
    daily_refresh_hour_utc: int = 2
    daily_refresh_poll_seconds: int = 3600
    port: int = 3011

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
