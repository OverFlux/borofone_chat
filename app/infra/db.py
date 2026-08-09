from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.settings import settings

engine: AsyncEngine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,    # Проверка соединения перед использованием
    pool_recycle=3600,     # Пересоздание соединений каждый час
    pool_timeout=settings.db_pool_timeout_seconds,
    # Connection timeout settings for asyncpg
    connect_args={
        "timeout": 10,   # Connection timeout in seconds
    },
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
