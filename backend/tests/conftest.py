import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.core.config import settings
from app.main import app

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://examflow:examflow@localhost:5432/examflow_test",
)


@pytest_asyncio.fixture
async def db_engine():
    """Fresh schema per test against a real Postgres test database.

    These are integration smoke tests, not unit tests — the models use
    Postgres-specific column types (JSONB, native UUID), so an in-memory
    SQLite substitute is not a faithful stand-in. Skips (rather than fails)
    when no test database is reachable, e.g. this sandbox without Docker.
    """
    engine = create_async_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except (SQLAlchemyError, OSError):
        await engine.dispose()
        pytest.skip(
            "Postgres test database not reachable at "
            f"{TEST_DATABASE_URL!r} (set TEST_DATABASE_URL or run `docker compose up postgres`)."
        )
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def require_redis():
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        await redis.ping()
    except (RedisError, OSError):
        pytest.skip(f"Redis not reachable at {settings.redis_url!r} (run `docker compose up redis`).")
    finally:
        await redis.aclose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_engine, require_redis):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
