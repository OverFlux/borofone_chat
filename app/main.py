import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse

from app.infra.db import engine
from app.infra.redis import redis_client
from app.models import Base
from app.api.http import router as http_router
from app.api.ws import router as ws_router
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from contextlib import asynccontextmanager
from app.api import auth, http, ws, rooms

app = FastAPI()
app.include_router(auth.router)

app.add_middleware(CORSMiddleware, ...)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrations are applied manually via alembic upgrade
    yield

    # Shutdown
    from app.infra.redis import close_redis
    await close_redis()  # ← Добавь
    await engine.dispose() # Close connection pool with SQLAlchemy

ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

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

# prod CORS
# from fastapi.middleware.cors import CORSMiddleware
#
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=[
#         "https://your-domain.com"
#     ],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
#
@app.get("/")
async def root():
    return RedirectResponse(url="main.html")

app.include_router(http_router, tags=["HTTP"]) # Add a router with HTTP endpoints
app.include_router(ws_router, tags=["Websocket"]) # Add a router with WebSockets endpoints
app.include_router(auth_router)  # /auth/*
app.include_router(admin_router)  # /admin/invites/*

app.include_router(rooms.router)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/", StaticFiles(directory="pages", html=True), name="pages")
