import asyncio
import os
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, FileResponse, HTMLResponse

from app.infra.db import engine
from app.infra.redis import get_redis_client
from app.models import Base
from app.api.http import router as http_router
from app.api.ws import router as ws_router
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from app.api import auth, http, ws, rooms, attachments, voice_rooms, wordle

# Base allowed origins
ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://borofone-chat.loca.lt",
    # HTTPS local development
    "https://localhost:443",
    "https://localhost",
    "https://127.0.0.1:443",
    "https://127.0.0.1",
]

# Add Radmin VPN IP if configured
RADMIN_IP = os.getenv("RADMIN_IP", "26.150.183.241")
if RADMIN_IP:
    ALLOWED_ORIGINS.extend([
        f"https://{RADMIN_IP}",
        f"https://{RADMIN_IP}:443",
        f"http://{RADMIN_IP}:8000",  # Fallback for HTTP
    ])

# Add custom origins from environment variable
CUSTOM_ORIGINS = os.getenv("ALLOWED_ORIGINS", "")
if CUSTOM_ORIGINS:
    ALLOWED_ORIGINS.extend([origin.strip() for origin in CUSTOM_ORIGINS.split(",") if origin.strip()])

# Добавляем IP адрес VPS для HTTPS
ALLOWED_ORIGINS.extend([
    "https://91.132.161.44",
    "https://91.132.161.44:9443",
    "http://91.132.161.44",
    "http://91.132.161.44:8000",
])

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrations are applied manually via alembic upgrade
    yield

    # Shutdown
    from app.infra.redis import close_redis
    await close_redis()
    await engine.dispose() # Close connection pool with SQLAlchemy

app = FastAPI(
    title="Borofone Chat API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS for browser-based login/register pages (incl. preflight OPTIONS)
app.add_middleware(
    CORSMiddleware,
    allow_origins = ALLOWED_ORIGINS,
    allow_credentials = True,
    allow_methods = ["*"],
    allow_headers = ["*"],
    expose_headers = ["Set-Cookie"],
)

# Middleware to add Cross-Origin headers for Godot game (COOP/COEP)
@app.middleware("http")
async def add_cross_origin_headers(request: Request, call_next: Callable):
    response: Response = await call_next(request)
    
    # Add COOP and COEP headers for game files
    if request.url.path.startswith("/games/"):
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
    
    return response

@app.get("/")
async def root():
    return RedirectResponse(url="main.html")

@app.get("/favicon.ico")
async def favicon():
    return FileResponse("favicon.ico")

# Endpoint to list custom emojis
@app.get("/api/emoji")
async def list_custom_emojis():
    """List all custom emoji files in the pages/emoji folder"""
    import os
    emoji_dir = "pages/emoji"
    if os.path.isdir(emoji_dir):
        emojis = [f for f in os.listdir(emoji_dir) if f.lower().endswith(('.gif', '.png', '.jpg', '.jpeg', '.webp'))]
        return {"emojis": emojis}
    return {"emojis": []}

# Endpoint to list stickers
@app.get("/api/stickers")
async def list_stickers():
    """List all stickers in the pages/stickers folder"""
    import os
    sticker_dir = "pages/stickers"
    if os.path.isdir(sticker_dir):
        # Support png, jpg, gif, webp, exclude README files
        stickers = [f for f in os.listdir(sticker_dir) 
                   if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')) 
                   and not f.lower().startswith('readme')]
        return {"stickers": stickers}
    return {"stickers": []}

# Endpoint to list GIFs
@app.get("/api/gifs")
async def list_gifs():
    """List all GIFs in the pages/gifs folder"""
    import os
    gifs_dir = "pages/gifs"
    if os.path.isdir(gifs_dir):
        # Exclude README files
        gifs = [f for f in os.listdir(gifs_dir) 
               if f.lower().endswith(('.gif', '.webp')) and not f.lower().startswith('readme')]
        return {"gifs": gifs}
    return {"gifs": []}

# Endpoint to get all media (emoji, stickers, gifs) at once
@app.get("/api/media")
async def list_all_media():
    """List all custom emoji, stickers, and GIFs in one call"""
    import os
    
    result = {"emojis": [], "stickers": [], "gifs": []}
    
    # Emoji folder
    emoji_dir = "pages/emoji"
    if os.path.isdir(emoji_dir):
        result["emojis"] = [f for f in os.listdir(emoji_dir) if f.lower().endswith(('.gif', '.png', '.jpg', '.jpeg', '.webp'))]
    
    # Stickers folder
    sticker_dir = "pages/stickers"
    if os.path.isdir(sticker_dir):
        result["stickers"] = [f for f in os.listdir(sticker_dir) 
                             if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp'))
                             and not f.lower().startswith('readme')]
    
    # GIFs folder
    gifs_dir = "pages/gifs"
    if os.path.isdir(gifs_dir):
        result["gifs"] = [f for f in os.listdir(gifs_dir) 
                         if f.lower().endswith(('.gif', '.webp')) and not f.lower().startswith('readme')]
    
    return result

app.include_router(http_router, tags=["HTTP"]) # Add a router with HTTP endpoints
app.include_router(ws_router, tags=["Websocket"]) # Add a router with WebSockets endpoints
app.include_router(auth_router)  # /auth/*
app.include_router(admin_router)  # /admin/invites/*

app.include_router(rooms.router)
app.include_router(attachments.router)
app.include_router(voice_rooms.router)
app.include_router(wordle.router)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/", StaticFiles(directory="pages", html=True), name="pages")
