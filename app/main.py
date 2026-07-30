import json
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import (
    direct_messages,
    health,
    integrations,
    platform_admin,
    rooms,
    servers,
    voice_rooms,
    webrtc,
)
from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.http import router as http_router
from app.api.ws import router as ws_router
from app.infra.db import engine
from app.settings import settings
from app.version import VERSION


def _list_media_files(directory, suffixes: tuple[str, ...]) -> list[str]:
    if not directory.is_dir():
        return []

    items = []
    for entry in directory.iterdir():
        if not entry.is_file():
            continue
        if not entry.name.lower().endswith(suffixes):
            continue
        items.append(entry.name)
    return items


class CachedStaticFiles(StaticFiles):
    _HTML_EXTENSIONS = {'.html'}
    _REVALIDATED_EXTENSIONS = {'.css', '.js', '.json', '.map'}
    _IMMUTABLE_EXTENSIONS = {
        '.gif', '.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico',
        '.mp3', '.wav', '.ogg', '.woff', '.woff2'
    }

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code >= 400:
            return response

        full_path, _ = self.lookup_path(path)
        suffix = Path(full_path).suffix.lower() if full_path else ''

        if suffix in self._HTML_EXTENSIONS:
            response.headers.setdefault('Cache-Control', 'no-cache')
        elif suffix in self._REVALIDATED_EXTENSIONS:
            response.headers.setdefault(
                'Cache-Control',
                'public, max-age=604800, stale-while-revalidate=86400',
            )
        elif suffix in self._IMMUTABLE_EXTENSIONS:
            response.headers.setdefault('Cache-Control', 'public, max-age=31536000, immutable')

        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

    from app.infra.redis import close_redis

    await close_redis()
    await engine.dispose()


app = FastAPI(
    title='Borotalk API',
    version='1.0.0',
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
    expose_headers=['Set-Cookie'],
)
if settings.app_env.lower() == 'production' and settings.public_base_url:
    public_host = urlparse(settings.public_base_url).hostname
    if public_host:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=[public_host])
app.add_middleware(
    GZipMiddleware,
    minimum_size=1024,
    compresslevel=5,
)


@app.middleware("http")
async def verify_browser_origin(request: Request, call_next):
    if (
        request.method in {"POST", "PUT", "PATCH", "DELETE"}
        and request.url.path != "/api/integrations/telegram/webhook"
    ):
        origin = request.headers.get("origin")
        production = settings.app_env.lower() == "production"
        if (production and not origin) or (
            origin and origin.rstrip("/") not in settings.allowed_origins_list
        ):
            return JSONResponse(status_code=403, content={"detail": "Untrusted origin"})
    return await call_next(request)


@app.get('/app-config.js', include_in_schema=False)
async def app_config_js() -> Response:
    payload = {
        'apiUrl': settings.resolved_public_api_base_url,
        'wsUrl': settings.resolved_public_ws_base_url,
        'appVersion': VERSION,
        'routes': {
            'main': settings.main_page_route,
            'login': settings.login_page_route,
            'register': settings.register_page_route,
        },
        'uploads': {
            'avatarsBasePath': settings.avatar_public_path,
        },
        'features': {
            'telegramPairing': bool(
                settings.telegram_bot_token
                and settings.telegram_bot_username
                and settings.telegram_webhook_secret
            ),
        },
        'appEnv': settings.app_env,
        'storageNamespace': settings.runtime_namespace,
    }
    response = Response(
        content=f'window.__BOROTALK_RUNTIME_CONFIG__ = {json.dumps(payload, ensure_ascii=False)};\n',
        media_type='application/javascript',
    )
    response.headers['Cache-Control'] = 'no-cache'
    return response


@app.get('/')
async def root():
    return FileResponse(
        settings.pages_path / 'index.html',
        headers={'Cache-Control': 'no-cache'},
    )


@app.get('/favicon.ico')
async def favicon():
    favicon_path = settings.favicon_file
    if not favicon_path.is_file():
        favicon_path = settings.pages_path / 'icons' / 'borotalk-64.png'
    return FileResponse(favicon_path, headers={'Cache-Control': 'public, max-age=604800'})


@app.get('/api/emoji')
async def list_custom_emojis():
    return {'emojis': _list_media_files(settings.emoji_path, ('.gif', '.png', '.jpg', '.jpeg', '.webp'))}


app.include_router(http_router, tags=['HTTP'])
app.include_router(ws_router, tags=['Websocket'])
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(platform_admin.router)
app.include_router(integrations.router)
app.include_router(webrtc.router)
app.include_router(health.router)
app.include_router(servers.router)
app.include_router(direct_messages.router)
app.include_router(rooms.router)
app.include_router(voice_rooms.router)

settings.avatars_path.mkdir(parents=True, exist_ok=True)

app.mount(
    settings.avatar_public_path,
    CachedStaticFiles(directory=settings.avatars_path),
    name='avatars',
)
app.mount('/', CachedStaticFiles(directory=settings.pages_path, html=True), name='pages')
