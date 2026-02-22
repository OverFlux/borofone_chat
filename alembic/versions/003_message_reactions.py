"""Add message reactions and reply links

Revision ID: 003_message_reactions
Revises: 002_attachments
Create Date: 2026-02-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '003_message_reactions'
down_revision: Union[str, None] = '002_attachments'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'message_reactions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('message_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('emoji', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('message_id', 'user_id', 'emoji', name='uq_message_user_emoji'),
    )
    op.create_index('idx_message_reactions_message_id', 'message_reactions', ['message_id'], unique=False)
    op.create_index('idx_message_reactions_user_id', 'message_reactions', ['user_id'], unique=False)

    op.add_column('messages', sa.Column('reply_to_id', sa.Integer(), nullable=True))
    op.create_index('ix_messages_reply_to_id', 'messages', ['reply_to_id'], unique=False)
    op.create_foreign_key(
        'fk_messages_reply_to_id_messages',
        'messages',
        'messages',
        ['reply_to_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_messages_reply_to_id_messages', 'messages', type_='foreignkey')
    op.drop_index('ix_messages_reply_to_id', table_name='messages')
    op.drop_column('messages', 'reply_to_id')

    op.drop_index('idx_message_reactions_user_id', table_name='message_reactions')
    op.drop_index('idx_message_reactions_message_id', table_name='message_reactions')
    op.drop_table('message_reactions')
