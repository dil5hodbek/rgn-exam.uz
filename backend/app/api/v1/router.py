from fastapi import APIRouter

from app.api.v1 import admin, attempts, auth, catalog

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(catalog.router)
api_router.include_router(attempts.router)
api_router.include_router(admin.router)
