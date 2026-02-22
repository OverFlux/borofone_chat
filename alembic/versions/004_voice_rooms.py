"""Add voice rooms

Revision ID: 004_voice_rooms
Revises: 003_message_reactions
Create Date: 2026-02-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '004_voice_rooms'
down_revision: Union[str, None] = '003_message_reactions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'voice_rooms',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_voice_rooms_is_active', 'voice_rooms', ['is_active'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_voice_rooms_is_active', table_name='voice_rooms')
    op.drop_table('voice_rooms')
