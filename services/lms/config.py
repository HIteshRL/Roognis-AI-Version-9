from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = Field(
        "postgresql+psycopg://postgres:postgres@postgres:5432/roognis",
        description="SQLAlchemy database URL for the shared roognis database.",
    )
    lms_db_schema: str = Field(
        "lms_db",
        description="PostgreSQL schema owned by the LMS / Classroom service.",
    )
    jwt_secret: str = Field(
        "dev-only-lms-secret",
        description="Shared JWT secret used to verify teacher/student cookies (matches Auth Service).",
    )
    internal_service_token: str = Field(
        "",
        description="Shared service-to-service token for internal LMS calls (AI / RAG / Analytics).",
    )
    analytics_url: str = Field(
        "",
        description="Analytics Service base URL for fire-and-forget classroom events.",
    )
    rag_service_url: str = Field(
        "",
        description="RAG Service base URL (reserved for chapter knowledge-base linkage).",
    )
    lms_test_mode: bool = Field(
        False,
        description="Enables lightweight test defaults for pytest/TestClient runs.",
    )
    db_pool_size: int = Field(
        5,
        ge=1,
        description="SQLAlchemy connection pool size. Explicit rather than the "
        "library default, since 8 services already share one Postgres instance "
        "with a stock max_connections=100 and no PgBouncer in front of it.",
    )
    db_max_overflow: int = Field(
        5,
        ge=0,
        description="Extra connections allowed beyond db_pool_size under burst load.",
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.database_url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
