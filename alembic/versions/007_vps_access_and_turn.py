"""Add VPS onboarding, private server access, sessions and notification outbox.

Revision ID: 007_vps_access_and_turn
Revises: 006_servers_and_direct_messages
"""

from alembic import op
import sqlalchemy as sa


revision = "007_vps_access_and_turn"
down_revision = "006_servers_and_direct_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("public_id", sa.String(length=24), nullable=True))
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_public_id", "users", ["public_id"], unique=True)

    op.add_column("servers", sa.Column("public_id", sa.String(length=24), nullable=True))
    op.create_index("ix_servers_public_id", "servers", ["public_id"], unique=True)

    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE users SET public_id = 'usr_' || substr(md5(random()::text || id::text), 1, 16) "
            "WHERE public_id IS NULL"
        )
    )
    connection.execute(
        sa.text(
            "UPDATE servers SET public_id = 'srv_' || substr(md5(random()::text || id::text), 1, 16) "
            "WHERE public_id IS NULL"
        )
    )
    op.alter_column("users", "public_id", nullable=False)
    op.alter_column("servers", "public_id", nullable=False)
    connection.execute(sa.text("UPDATE servers SET is_joinable = false"))
    connection.execute(
        sa.text(
            "UPDATE invites SET revoked = true "
            "WHERE revoked = false AND (max_uses IS NULL OR max_uses > 1)"
        )
    )

    op.create_table(
        "registration_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("public_id", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=50), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("invite_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="awaiting_email"),
        sa.Column("email_token_hash", sa.String(length=64), nullable=True),
        sa.Column("email_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["invite_id"], ["invites.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_registration_requests_public_id", "registration_requests", ["public_id"], unique=True)
    op.create_index("ix_registration_requests_email", "registration_requests", ["email"])
    op.create_index("ix_registration_requests_username", "registration_requests", ["username"])
    op.create_index("ix_registration_requests_status", "registration_requests", ["status"])
    op.create_index(
        "uq_registration_requests_active_email",
        "registration_requests",
        ["email"],
        unique=True,
        postgresql_where=sa.text("status IN ('awaiting_email', 'awaiting_approval')"),
    )
    op.create_index(
        "uq_registration_requests_active_username",
        "registration_requests",
        ["username"],
        unique=True,
        postgresql_where=sa.text("status IN ('awaiting_email', 'awaiting_approval')"),
    )
    op.create_unique_constraint(
        "uq_registration_requests_email_token_hash",
        "registration_requests",
        ["email_token_hash"],
    )

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])
    op.create_index("ix_password_reset_tokens_token_hash", "password_reset_tokens", ["token_hash"], unique=True)

    op.create_table(
        "user_email_verification_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_user_email_verification_tokens_user_id",
        "user_email_verification_tokens",
        ["user_id"],
    )
    op.create_index(
        "ix_user_email_verification_tokens_token_hash",
        "user_email_verification_tokens",
        ["token_hash"],
        unique=True,
    )

    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by_jti", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_refresh_sessions_jti", "refresh_sessions", ["jti"], unique=True)
    op.create_index("ix_refresh_sessions_user_id", "refresh_sessions", ["user_id"])

    op.create_table(
        "notification_outbox",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("recipient", sa.String(length=255), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notification_outbox_kind", "notification_outbox", ["kind"])
    op.create_index("ix_notification_outbox_available_at", "notification_outbox", ["available_at"])

    op.create_table(
        "telegram_admin_bindings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("singleton_key", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("admin_user_id", sa.Integer(), nullable=False),
        sa.Column("telegram_user_id", sa.String(length=32), nullable=True),
        sa.Column("telegram_chat_id", sa.String(length=32), nullable=True),
        sa.Column("pair_token_hash", sa.String(length=64), nullable=True),
        sa.Column("pair_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["admin_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("singleton_key"),
        sa.UniqueConstraint("admin_user_id"),
        sa.UniqueConstraint("telegram_user_id"),
        sa.UniqueConstraint("pair_token_hash"),
    )

    op.create_table(
        "server_invites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=48), nullable=False),
        sa.Column("server_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("max_uses", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("current_uses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_server_invites_code", "server_invites", ["code"], unique=True)
    op.create_index("ix_server_invites_server_id", "server_invites", ["server_id"])

    op.create_table(
        "server_join_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("server_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("reviewed_by", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_server_join_requests_server_id", "server_join_requests", ["server_id"])
    op.create_index("ix_server_join_requests_user_id", "server_join_requests", ["user_id"])
    op.create_index("ix_server_join_requests_status", "server_join_requests", ["status"])
    op.create_index(
        "uq_server_join_requests_pending",
        "server_join_requests",
        ["server_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("uq_server_join_requests_pending", table_name="server_join_requests")
    op.drop_index("ix_server_join_requests_status", table_name="server_join_requests")
    op.drop_index("ix_server_join_requests_user_id", table_name="server_join_requests")
    op.drop_index("ix_server_join_requests_server_id", table_name="server_join_requests")
    op.drop_table("server_join_requests")
    op.drop_index("ix_server_invites_server_id", table_name="server_invites")
    op.drop_index("ix_server_invites_code", table_name="server_invites")
    op.drop_table("server_invites")
    op.drop_table("telegram_admin_bindings")
    op.drop_index("ix_notification_outbox_available_at", table_name="notification_outbox")
    op.drop_index("ix_notification_outbox_kind", table_name="notification_outbox")
    op.drop_table("notification_outbox")
    op.drop_index("ix_refresh_sessions_user_id", table_name="refresh_sessions")
    op.drop_index("ix_refresh_sessions_jti", table_name="refresh_sessions")
    op.drop_table("refresh_sessions")
    op.drop_index(
        "ix_user_email_verification_tokens_token_hash",
        table_name="user_email_verification_tokens",
    )
    op.drop_index(
        "ix_user_email_verification_tokens_user_id",
        table_name="user_email_verification_tokens",
    )
    op.drop_table("user_email_verification_tokens")
    op.drop_index("ix_password_reset_tokens_token_hash", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
    op.drop_constraint(
        "uq_registration_requests_email_token_hash",
        "registration_requests",
        type_="unique",
    )
    op.drop_index("uq_registration_requests_active_username", table_name="registration_requests")
    op.drop_index("uq_registration_requests_active_email", table_name="registration_requests")
    op.drop_index("ix_registration_requests_status", table_name="registration_requests")
    op.drop_index("ix_registration_requests_username", table_name="registration_requests")
    op.drop_index("ix_registration_requests_email", table_name="registration_requests")
    op.drop_index("ix_registration_requests_public_id", table_name="registration_requests")
    op.drop_table("registration_requests")
    op.drop_index("ix_servers_public_id", table_name="servers")
    op.drop_column("servers", "public_id")
    op.drop_index("ix_users_public_id", table_name="users")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "public_id")
