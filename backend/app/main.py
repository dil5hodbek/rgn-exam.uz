from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.core.config import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Database-driven English examination platform.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list({
        settings.frontend_url,
        *((
            "http://localhost:3000", "http://127.0.0.1:3000",
            "http://localhost:13000", "http://127.0.0.1:13000",
        ) if settings.environment == "development" else ()),
    }),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api/v1")
app.mount("/media", StaticFiles(directory=settings.storage_path, check_dir=False), name="media")


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "examflow-api"}
