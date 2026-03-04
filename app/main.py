import asyncio
import os
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, FileResponse

from app.infra.db import engine
from app.infra.redis import redis_client
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
