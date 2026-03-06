"""API v1 router — aggrega tutti gli endpoint v1."""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    audit,
    auth,
    auth_webauthn,
    files,
    folders,
    gdpr,
    groups,
    guest,
    health,
    metadata,
    notifications,
    permissions,
    search,
    share_links,
    signatures,
    users,
)
from app.api.v1.endpoints import test_seed

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(test_seed.router)
api_router.include_router(auth.router)
api_router.include_router(auth_webauthn.router)
api_router.include_router(users.router)
api_router.include_router(groups.router)
api_router.include_router(folders.router)
api_router.include_router(files.router)
api_router.include_router(metadata.router)
api_router.include_router(search.router)
api_router.include_router(share_links.router)
api_router.include_router(share_links.sync_router)
api_router.include_router(signatures.router)
api_router.include_router(guest.router)
api_router.include_router(guest.public_router)
api_router.include_router(permissions.router)
api_router.include_router(notifications.router)
api_router.include_router(gdpr.router)
api_router.include_router(audit.router)
