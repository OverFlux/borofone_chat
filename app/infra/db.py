from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.settings import settings

# Настройки пула соединений для поддержки множества пользователей
engine: AsyncEngine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=20,          # Количество постоянных соединений
    max_overflow=10,       # Дополнительные соединения при пике нагрузки
    pool_pre_ping=True,    # Проверка соединения перед использованием
    pool_recycle=3600,     # Пересоздание соединений каждый час
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
