"""
Presence tracking - отслеживание онлайн пользователей в комнатах.

Использует Redis sets для хранения списка активных пользователей.
Также записывает статус в БД для истории и отображения оффлайн пользователей.
"""
from datetime import datetime, timezone
from typing import Optional

from redis.asyncio import Redis
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


async def user_joined_room(redis: Redis | None, room_id: int, user_id: int) -> None:
    """
    Пользователь присоединился к комнате (открыл её).
    
    Добавляет user_id в Redis set `room:{room_id}:online`
    Также обновляет статус is_online и last_seen в БД.
    """
    if not redis:
        return
    
    try:
        await redis.sadd(f"room:{room_id}:online", str(user_id))
        # TTL 30 секунд — если пользователь не обновит, считается оффлайн
        await redis.expire(f"room:{room_id}:online", 30)
    except Exception as e:
        print(f"[Presence] Error joining room: {e}")


async def user_left_room(redis: Redis | None, room_id: int, user_id: int) -> None:
    """
    Пользователь покинул комнату (закрыл вкладку или сменил комнату).
    
    Удаляет user_id из Redis set `room:{room_id}:online`
    """
    if not redis:
        return
    
    try:
        await redis.srem(f"room:{room_id}:online", str(user_id))
    except Exception as e:
        print(f"[Presence] Error leaving room: {e}")


async def get_online_users(redis: Redis | None, room_id: int) -> list[int]:
    """
    Получить список ID онлайн пользователей в комнате.
    
    Returns:
        List[int]: Список user_id
    """
    if not redis:
        return []
    
    try:
        members = await redis.smembers(f"room:{room_id}:online")
        return [int(m) for m in members]
    except Exception as e:
        print(f"[Presence] Error getting online users: {e}")
        return []


async def heartbeat_room(redis: Redis | None, room_id: int, user_id: int) -> None:
    """
    Heartbeat — обновление присутствия пользователя.
    
    Вызывается периодически (каждые 10-15 сек) чтобы продлить TTL.
    """
    if not redis:
        return
    
    try:
        # Проверяем что пользователь в set
        is_member = await redis.sismember(f"room:{room_id}:online", str(user_id))
        if is_member:
            # Продляем TTL
            await redis.expire(f"room:{room_id}:online", 30)
    except Exception as e:
        print(f"[Presence] Error heartbeat: {e}")


async def set_user_online(db: AsyncSession, user_id: int) -> None:
    """
    Установить статус пользователя как онлайн и обновить last_seen.
    """
    try:
        user = await db.get(User, user_id)
        if user:
            now = datetime.now(timezone.utc)
            user.is_online = True
            user.last_seen = now
            await db.commit()
    except Exception as e:
        print(f"[Presence] Error setting user online: {e}")
        await db.rollback()


async def set_user_offline(db: AsyncSession, user_id: int) -> None:
    """
    Установить статус пользователя как оффлайн и обновить last_seen.
    """
    try:
        user = await db.get(User, user_id)
        if user:
            now = datetime.now(timezone.utc)
            user.is_online = False
            user.last_seen = now
            await db.commit()
    except Exception as e:
        print(f"[Presence] Error setting user offline: {e}")
        await db.rollback()


async def get_all_users_with_status(
    db: AsyncSession,
    room_id: Optional[int] = None,
    status_filter: Optional[str] = None,  # "online", "offline", or None for all
    search_query: Optional[str] = None,
    sort_by: str = "last_seen",  # "last_seen", "username", "display_name"
    sort_order: str = "desc",  # "asc" or "desc"
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """
    Получить всех пользователей с их статусом онлайн/оффлайн.
    
    Args:
        db: Сессия БД
        room_id: Опционально фильтр по комнате (для получения онлайн в конкретной комнате)
        status_filter: Фильтр по статусу ("online", "offline", или None)
        search_query: Поиск по username или display_name
        sort_by: Поле для сортировки
        sort_order: Порядок сортировки
        limit: Лимит записей
        offset: Смещение для пагинации
    
    Returns:
        Кортеж (список пользователей, общее количество)
    """
    from app.infra.redis import redis_client
    
    # Получаем ID онлайн пользователей в комнате
    online_ids = set()
    if room_id and redis_client:
        try:
            online_ids = set(await get_online_users(redis_client, room_id))
        except Exception as e:
            print(f"[Presence] Error getting online IDs: {e}")
    
    # Базовый запрос - все активные пользователи
    stmt = select(User).where(User.is_active == True)
    
    # Применяем фильтр по статусу
    if status_filter == "online":
        stmt = stmt.where(User.is_online == True)
    elif status_filter == "offline":
        stmt = stmt.where(User.is_online == False)
    
    # Применяем поиск
    if search_query:
        search_pattern = f"%{search_query}%"
        stmt = stmt.where(
            or_(
                User.username.ilike(search_pattern),
                User.display_name.ilike(search_pattern)
            )
        )
    
    # Получаем общее количество
    from sqlalchemy import func as sql_func
    count_stmt = select(sql_func.count()).select_from(stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0
    
    # Применяем сортировку
    if sort_by == "username":
        order_col = User.username
    elif sort_by == "display_name":
        order_col = User.display_name
    else:  # last_seen
        # Сортируем по last_seen, но NULL (никогда не был онлайн) в конец
        order_col = User.last_seen
    
    if sort_order == "desc":
        stmt = stmt.order_by(order_col.desc().nullslast())
    else:
        stmt = stmt.order_by(order_col.asc().nullslast())
    
    # Пагинация
    stmt = stmt.limit(limit).offset(offset)
    
    result = await db.execute(stmt)
    users = result.scalars().all()
    
    # Формируем ответ
    now = datetime.now(timezone.utc)
    user_list = []
    for user in users:
        is_online_in_room = user.id in online_ids if room_id else user.is_online
        
        user_list.append({
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
            "is_online": is_online_in_room,
            "last_seen": user.last_seen.isoformat() if user.last_seen else None,
            "last_seen_formatted": format_last_seen(user.last_seen, now) if user.last_seen else "Никогда",
        })
    
    return user_list, total


def format_last_seen(last_seen: datetime, now: datetime) -> str:
    """
    Форматировать время последнего появления в удобочитаемом формате.
    """
    if not last_seen:
        return "Никогда"
    
    # Убедимся что обе даты с timezone
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    
    diff = now - last_seen
    
    if diff.total_seconds() < 60:
        return "Только что"
    elif diff.total_seconds() < 3600:
        minutes = int(diff.total_seconds() / 60)
        return f"{minutes} мин. назад"
    elif diff.total_seconds() < 86400:
        hours = int(diff.total_seconds() / 3600)
        return f"{hours} ч. назад"
    elif diff.days == 1:
        return "Вчера"
    elif diff.days < 7:
        return f"{diff.days} дн. назад"
    elif diff.days < 30:
        weeks = diff.days // 7
        return f"{weeks} нед. назад"
    elif diff.days < 365:
        months = diff.days // 30
        return f"{months} мес. назад"
    else:
        years = diff.days // 365
        return f"{years} г. назад"


async def check_and_update_offline_users(db: AsyncSession, redis: Redis | None) -> None:
    """
    Проверить и обновить статус пользователей, которые были онлайн но больше не в Redis.
    Вызывается периодически для синхронизации статуса.
    """
    try:
        # Получаем всех пользователей с is_online = True
        stmt = select(User).where(User.is_online == True)
        result = await db.execute(stmt)
        online_users = result.scalars().all()
        
        now = datetime.now(timezone.utc)
        
        for user in online_users:
            # Проверяем, есть ли пользователь хотя бы в одной комнате
            found_online = False
            
            if redis:
                try:
                    # Получаем все комнаты
                    from app.models import Room
                    rooms_result = await db.execute(select(Room.id))
                    room_ids = rooms_result.scalars().all()
                    
                    for room_id in room_ids:
                        is_member = await redis.sismember(f"room:{room_id}:online", str(user.id))
                        if is_member:
                            found_online = True
                            break
                except Exception as e:
                    print(f"[Presence] Error checking room presence: {e}")
            
            # Если не найден ни в одной комнате, помечаем оффлайн
            if not found_online:
                user.is_online = False
                # Обновляем last_seen только если он был давно (больше 5 минут)
                if not user.last_seen or (now - user.last_seen).total_seconds() > 300:
                    user.last_seen = now
        
        await db.commit()
    except Exception as e:
        print(f"[Presence] Error updating offline users: {e}")
        await db.rollback()
