"""Add server-scoped channels and private conversations.

Revision ID: 006_servers_and_direct_messages
Revises: 005_user_presence
"""

from alembic import op
import sqlalchemy as sa


revision = "006_servers_and_direct_messages"
down_revision = "005_user_presence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "servers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("is_joinable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_servers_owner_id", "servers", ["owner_id"])

    op.create_table(
        "server_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("server_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="member"),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("server_id", "user_id", name="uq_server_member"),
    )
    op.create_index("ix_server_members_server_id", "server_members", ["server_id"])
    op.create_index("ix_server_members_user_id", "server_members", ["user_id"])

    # Preserve the existing application as one server instead of exposing its
    # rooms to every future account.
    connection = op.get_bind()
    legacy_server_id = connection.execute(
        sa.text("INSERT INTO servers (name, is_joinable) VALUES ('Borofone legacy', true) RETURNING id")
    ).scalar_one()
    connection.execute(
        sa.text("INSERT INTO server_members (server_id, user_id, role) SELECT :server_id, id, 'member' FROM users"),
        {"server_id": legacy_server_id},
    )

    op.add_column("rooms", sa.Column("server_id", sa.Integer(), nullable=True))
    op.add_column("voice_rooms", sa.Column("server_id", sa.Integer(), nullable=True))
    connection.execute(sa.text("UPDATE rooms SET server_id = :server_id"), {"server_id": legacy_server_id})
    connection.execute(sa.text("UPDATE voice_rooms SET server_id = :server_id"), {"server_id": legacy_server_id})
    op.alter_column("rooms", "server_id", nullable=False)
    op.alter_column("voice_rooms", "server_id", nullable=False)
    op.create_foreign_key("fk_rooms_server_id_servers", "rooms", "servers", ["server_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_voice_rooms_server_id_servers", "voice_rooms", "servers", ["server_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_rooms_server_id", "rooms", ["server_id"])
    op.create_index("ix_voice_rooms_server_id", "voice_rooms", ["server_id"])

    op.create_table(
        "direct_conversations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_low_id", sa.Integer(), nullable=False),
        sa.Column("user_high_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("user_low_id < user_high_id", name="ck_direct_conversation_user_order"),
        sa.ForeignKeyConstraint(["user_low_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_high_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_low_id", "user_high_id", name="uq_direct_conversation_pair"),
    )
    op.create_index("ix_direct_conversations_user_low_id", "direct_conversations", ["user_low_id"])
    op.create_index("ix_direct_conversations_user_high_id", "direct_conversations", ["user_high_id"])

    op.create_table(
        "direct_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=True),
        sa.Column("nonce", sa.String(length=25), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], ["direct_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_direct_messages_conversation_id", "direct_messages", ["conversation_id"])
    op.create_index("ix_direct_messages_sender_id", "direct_messages", ["sender_id"])


def downgrade() -> None:
    op.drop_index("ix_direct_messages_sender_id", table_name="direct_messages")
    op.drop_index("ix_direct_messages_conversation_id", table_name="direct_messages")
    op.drop_table("direct_messages")
    op.drop_index("ix_direct_conversations_user_high_id", table_name="direct_conversations")
    op.drop_index("ix_direct_conversations_user_low_id", table_name="direct_conversations")
    op.drop_table("direct_conversations")

    op.drop_index("ix_voice_rooms_server_id", table_name="voice_rooms")
    op.drop_index("ix_rooms_server_id", table_name="rooms")
    op.drop_constraint("fk_voice_rooms_server_id_servers", "voice_rooms", type_="foreignkey")
    op.drop_constraint("fk_rooms_server_id_servers", "rooms", type_="foreignkey")
    op.drop_column("voice_rooms", "server_id")
    op.drop_column("rooms", "server_id")

    op.drop_index("ix_server_members_user_id", table_name="server_members")
    op.drop_index("ix_server_members_server_id", table_name="server_members")
    op.drop_table("server_members")
    op.drop_index("ix_servers_owner_id", table_name="servers")
    op.drop_table("servers")
