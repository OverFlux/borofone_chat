from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.models import Message

async def create_message_idempotent(db, room_id: int, payload):
    stmt = (
        insert(Message)
        .values(
            room_id=room_id,
            client_msg_id=payload.client_msg_id,
            author=payload.author,
            body=payload.body,
        )
        .on_conflict_do_nothing(
            index_elements=[Message.room_id, Message.client_msg_id]
        )
        .returning(Message.id)
    )

    result = await db.execute(stmt)
    inserted_id = result.scalar_one_or_none()

    if inserted_id is not None:
        await db.commit()
        msg = await db.get(Message, inserted_id)
        return msg

    # Конфликт: запись уже существует, достаём её
    msg = (
        await db.execute(
            select(Message).where(
                Message.room_id == room_id,
                Message.client_msg_id == payload.client_msg_id,
            )
        )
    ).scalar_one

    return msg
