"""Test AuditLog — TASK 5.5."""

import uuid as uuid_mod

import pytest

from app.config import get_settings


@pytest.mark.asyncio
async def test_audit_log_creates_entry():
    """Ogni operazione crea un entry audit."""
    get_settings.cache_clear()
    from sqlalchemy import select

    from app.database import AsyncSessionLocal
    from app.models.audit import AuditLog
    from app.models.user import User, UserRole
    from app.services.audit_service import AuditService

    async with AsyncSessionLocal() as db:
        user = User(
            email=f"audit_test_{uuid_mod.uuid4().hex[:8]}@test.com",
            display_name_encrypted="t",
            role=UserRole.USER,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        file_id = uuid_mod.uuid4()
        await AuditService.log(
            db,
            action="test_action",
            resource_type="file",
            resource_id=file_id,
            user_id=user.id,
            details={"test": True},
            outcome="success",
        )
        result = await db.execute(
            select(AuditLog).where(AuditLog.user_id == user.id)
        )
        entry = result.scalar_one_or_none()
        assert entry is not None
        assert entry.action == "test_action"
        assert entry.log_hash is not None
        assert len(entry.log_hash) == 64


@pytest.mark.asyncio
async def test_audit_chain_is_valid():
    """La catena di hash è integra dopo inserimenti multipli."""
    get_settings.cache_clear()
    from app.database import AsyncSessionLocal
    from app.services.audit_service import AuditService

    async with AsyncSessionLocal() as db:
        for i in range(5):
            await AuditService.log(
                db,
                action=f"chain_test_{i}",
                resource_type="test",
                details={"index": i},
            )
        result = await AuditService.verify_chain(db)
        assert result["valid"] is True
        assert result["entries"] >= 5


@pytest.mark.asyncio
async def test_audit_get_resource_history():
    """get_resource_history restituisce log per risorsa specifica."""
    get_settings.cache_clear()
    from app.database import AsyncSessionLocal
    from app.services.audit_service import AuditService

    file_id = uuid_mod.uuid4()
    async with AsyncSessionLocal() as db:
        for action in ["file_upload", "file_download", "file_download"]:
            await AuditService.log(
                db,
                action=action,
                resource_type="file",
                resource_id=file_id,
            )
        history = await AuditService.get_resource_history(
            db, "file", file_id
        )
        assert len(history) == 3
        assert history[0].action == "file_download"
