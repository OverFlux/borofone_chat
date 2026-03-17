import re
from functools import cached_property
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        extra='ignore',
    )

    app_env: str = 'development'
    app_host: str = '127.0.0.1'
    app_port: int = 8000

    database_url: str = 'postgresql+asyncpg://app:password@localhost:5432/app'
    redis_url: str = 'redis://localhost:6379/0'
    jwt_secret_key: str = 'CHANGE_ME_IN_PRODUCTION_USE_LONG_RANDOM_STRING'

    public_base_url: str = ''
    public_api_base_url: str = ''
    public_ws_base_url: str = ''
    allowed_origins: str = ''
    local_dev_origins: str = (
        'http://localhost:8000,'
        'http://127.0.0.1:8000,'
        'https://localhost:443,'
        'https://localhost,'
        'https://127.0.0.1:443,'
        'https://127.0.0.1'
    )
    radmin_ip: str = ''

    uploads_dir: str = 'uploads'
    pages_dir: str = 'pages'
    favicon_path: str = 'favicon.ico'
    main_page_path: str = 'main.html'
    login_page_path: str = 'login.html'
    register_page_path: str = 'register.html'
    emoji_subdir: str = 'emoji'
    stickers_subdir: str = 'stickers'
    gifs_subdir: str = 'gifs'
    leaderboard_subdir: str = 'web_backend/data'
    avatars_subdir: str = 'avatars'
    attachments_subdir: str = 'attachments'

    access_token_expire_days: int = 30
    refresh_token_expire_days: int = 30
    cookie_secure: bool = False
    cookie_samesite: str = 'lax'

    max_avatar_bytes: int = 3 * 1024 * 1024
    max_upload_file_size: int = 10 * 1024 * 1024

    ssl_host: str = '0.0.0.0'
    ssl_port: int = 443
    ssl_cert_path: str = 'ssl/cert.pem'
    ssl_key_path: str = 'ssl/key.pem'
    ssl_pfx_path: str = 'ssl/voice.pfx'
    ssl_pfx_password: str = '1234'

    @staticmethod
    def _split_csv(value: str) -> list[str]:
        return [item.strip() for item in value.split(',') if item.strip()]

    @staticmethod
    def _namespace_part(value: str) -> str:
        normalized = re.sub(r'[^a-zA-Z0-9_.-]+', '_', value.strip())
        normalized = normalized.strip('._-')
        return normalized or 'default'

    def _resolve_path(self, raw_path: str) -> Path:
        path = Path(raw_path)
        if path.is_absolute():
            return path
        return self.project_root / path

    @cached_property
    def project_root(self) -> Path:
        return Path(__file__).resolve().parent.parent

    @cached_property
    def uploads_path(self) -> Path:
        return self._resolve_path(self.uploads_dir)

    @cached_property
    def pages_path(self) -> Path:
        return self._resolve_path(self.pages_dir)

    @cached_property
    def favicon_file(self) -> Path:
        return self._resolve_path(self.favicon_path)

    @cached_property
    def avatars_path(self) -> Path:
        return self.uploads_path / self.avatars_subdir

    @cached_property
    def attachments_path(self) -> Path:
        return self.uploads_path / self.attachments_subdir

    @cached_property
    def emoji_path(self) -> Path:
        return self.pages_path / self.emoji_subdir

    @cached_property
    def stickers_path(self) -> Path:
        return self.pages_path / self.stickers_subdir

    @cached_property
    def gifs_path(self) -> Path:
        return self.pages_path / self.gifs_subdir

    @cached_property
    def leaderboard_file(self) -> Path:
        return self.pages_path / self.leaderboard_subdir / 'leaderboard.json'

    @property
    def main_page_route(self) -> str:
        return f'/{self.main_page_path.lstrip("/")}'

    @property
    def login_page_route(self) -> str:
        return f'/{self.login_page_path.lstrip("/")}'

    @property
    def register_page_route(self) -> str:
        return f'/{self.register_page_path.lstrip("/")}'

    @property
    def avatar_public_path(self) -> str:
        return f'/uploads/{self.avatars_subdir}'

    @property
    def attachments_public_path(self) -> str:
        return f'/uploads/{self.attachments_subdir}'

    @property
    def resolved_public_api_base_url(self) -> str:
        value = self.public_api_base_url or self.public_base_url
        return value.rstrip('/')

    @property
    def resolved_public_ws_base_url(self) -> str:
        if self.public_ws_base_url:
            return self.public_ws_base_url.rstrip('/')
        api_base = self.resolved_public_api_base_url
        if api_base.startswith('https://'):
            return 'wss://' + api_base[len('https://'):]
        if api_base.startswith('http://'):
            return 'ws://' + api_base[len('http://'):]
        return ''

    @property
    def allowed_origins_list(self) -> list[str]:
        origins: list[str] = []
        for value in self._split_csv(self.local_dev_origins):
            if value not in origins:
                origins.append(value)
        for value in self._split_csv(self.allowed_origins):
            if value not in origins:
                origins.append(value)
        for value in (self.public_base_url, self.public_api_base_url):
            normalized = value.rstrip('/')
            if normalized and normalized not in origins:
                origins.append(normalized)
        if self.radmin_ip:
            for value in (
                f'https://{self.radmin_ip}',
                f'https://{self.radmin_ip}:{self.ssl_port}',
                f'http://{self.radmin_ip}:{self.app_port}',
            ):
                if value not in origins:
                    origins.append(value)
        return origins

    @property
    def runtime_namespace(self) -> str:
        candidates = [
            self.resolved_public_api_base_url,
            self.public_base_url.rstrip('/'),
            self.app_env,
            f'{self.app_host}:{self.app_port}',
        ]
        parts = [self._namespace_part(value) for value in candidates if value]
        return '__'.join(parts) if parts else 'default'


settings = Settings()
