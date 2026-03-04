"""
Add last_seen and is_online fields to users table.

This migration adds presence tracking fields to store:
- last_seen: timestamp of user's last activity
- is_online: boolean indicating current online status
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import func


# revision identifiers, used by Alembic.
revision = '005_user_presence'
down_revision = '004_voice_rooms'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add last_seen column (nullable initially)
    op.add_column(
        'users',
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True, server_default=None)
    )
    
    # Add is_online column (default False)
    op.add_column(
        'users',
        sa.Column('is_online', sa.Boolean(), nullable=False, server_default='0')
    )
    
    # Create index for faster queries on last_seen
    op.create_index('ix_users_last_seen', 'users', ['last_seen'])
    op.create_index('ix_users_is_online', 'users', ['is_online'])


def downgrade() -> None:
    op.drop_index('ix_users_is_online', 'users')
    op.drop_index('ix_users_last_seen', 'users')
    op.drop_column('users', 'is_online')
    op.drop_column('users', 'last_seen')
