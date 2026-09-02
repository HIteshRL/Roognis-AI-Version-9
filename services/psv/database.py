from collections.abc import Generator

from sqlalchemy import MetaData, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateSchema

from config import get_settings

settings = get_settings()
metadata = MetaData(schema=settings.psv_db_schema if not settings.sqlalchemy_database_url.startswith("sqlite") else None)


class Base(DeclarativeBase):
    metadata = metadata


engine_options: dict = {"future": True, "pool_pre_ping": True}
if settings.sqlalchemy_database_url.startswith("sqlite"):
    engine_options.update({"connect_args": {"check_same_thread": False}, "poolclass": StaticPool})
else:
    engine_options.update({"pool_size": settings.db_pool_size, "max_overflow": settings.db_max_overflow})

engine = create_engine(settings.sqlalchemy_database_url, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)


def init_db() -> None:
    if settings.psv_db_schema and engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(CreateSchema(settings.psv_db_schema, if_not_exists=True))
    import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        # create_all intentionally owns first installation, but it does not
        # evolve an already-created pilot schema. Keep these additive changes
        # idempotent so rolling out the learner-state service cannot strand an
        # older table shape before a full migration framework is introduced.
        schema = engine.dialect.identifier_preparer.quote(settings.psv_db_schema)
        with engine.begin() as connection:
            connection.execute(text(
                f"ALTER TABLE {schema}.knowledge_gap_snapshots "
                "ADD COLUMN IF NOT EXISTS uncertainty DOUBLE PRECISION NOT NULL DEFAULT 1.0"
            ))
            connection.execute(text(
                f"ALTER TABLE {schema}.refresh_runs "
                "ADD COLUMN IF NOT EXISTS training_status VARCHAR(24) NOT NULL DEFAULT 'not_started'"
            ))
            connection.execute(text(
                f"ALTER TABLE {schema}.refresh_runs "
                "ADD COLUMN IF NOT EXISTS training_promoted BOOLEAN NOT NULL DEFAULT false"
            ))
            connection.execute(text(
                f"ALTER TABLE {schema}.refresh_runs "
                "ADD COLUMN IF NOT EXISTS training_reason VARCHAR(80)"
            ))
            connection.execute(text(
                f"ALTER TABLE {schema}.refresh_runs "
                "ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ"
            ))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
