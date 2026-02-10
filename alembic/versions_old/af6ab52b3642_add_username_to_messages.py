"""add username to messages

Revision ID: 094067030f1b
Revises: fef7c4b92ada
Create Date: 2026-02-09 01:48:xx.xxxxxx

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '094067030f1b'
down_revision: Union[str, Sequence[str], None] = 'fef7c4b92ada'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('messages', sa.Column('username', sa.String(length=32), nullable=True))

    op.execute("""
        UPDATE messages 
        SET username = users.username 
        FROM users 
        WHERE messages.user_id = users.id
    """)

    op.execute("""
        UPDATE messages 
        SET username = '[deleted]' 
        WHERE username IS NULL
    """)

    op.alter_column('messages', 'username',
                    existing_type=sa.String(length=32),
                    nullable=False)

    op.create_index(op.f('ix_messages_username'), 'messages', ['username'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_messages_username'), table_name='messages')
    op.drop_column('messages', 'username')
