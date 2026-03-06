"""Servizio reportistica: dashboard utente, admin, serie temporali."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_actions import AuditAction
from app.models.audit import AuditLog
from app.models.file import File
from app.models.guest import GuestSession
from app.models.share_link import ShareLink
from app.models.signature import FileSignature
from app.models.user import User
from app.schemas.reports import (
    ActivityStats,
    AdminDashboard,
    SharingStats,
    SignatureStats,
    StorageStats,
    TimeSeriesPoint,
    TimeSeriesReport,
    UserDashboard,
    UserSummary,
)


class ReportService:
    @staticmethod
    async def get_user_dashboard(
        db: AsyncSession, user_id: uuid.UUID
    ) -> UserDashboard:
        now = datetime.now(timezone.utc)
        last_30d = now - timedelta(days=30)

        # Storage
        storage_result = await db.execute(
            select(
                func.count(File.id).label("total_files"),
                func.coalesce(func.sum(File.size_bytes), 0).label("total_size"),
                func.coalesce(func.max(File.size_bytes), 0).label("max_size"),
                func.coalesce(func.avg(File.size_bytes), 0).label("avg_size"),
            ).where(File.owner_id == user_id, File.is_destroyed.is_(False))
        )
        sr = storage_result.one()

        # Sharing
        total_links = (
            await db.execute(
                select(func.count(ShareLink.id)).where(
                    ShareLink.owner_id == user_id
                )
            )
        ).scalar_one()
        active_links = (
            await db.execute(
                select(func.count(ShareLink.id)).where(
                    ShareLink.owner_id == user_id,
                    ShareLink.is_active.is_(True),
                )
            )
        ).scalar_one()
        total_downloads = (
            await db.execute(
                select(func.coalesce(func.sum(ShareLink.download_count), 0)).where(
                    ShareLink.owner_id == user_id
                )
            )
        ).scalar_one()
        total_guests = (
            await db.execute(
                select(func.count(GuestSession.id)).where(
                    GuestSession.invited_by == user_id
                )
            )
        ).scalar_one()
        active_guests = (
            await db.execute(
                select(func.count(GuestSession.id)).where(
                    GuestSession.invited_by == user_id,
                    GuestSession.is_active.is_(True),
                    GuestSession.expires_at > now,
                )
            )
        ).scalar_one()

        # Signatures
        signed_files = (
            await db.execute(
                select(func.count(File.id)).where(
                    File.owner_id == user_id,
                    File.is_signed.is_(True),
                    File.is_destroyed.is_(False),
                )
            )
        ).scalar_one()
        verified_sigs = (
            await db.execute(
                select(func.count(FileSignature.id))
                .join(File, File.id == FileSignature.file_id)
                .where(
                    File.owner_id == user_id,
                    FileSignature.is_valid.is_(True),
                )
            )
        ).scalar_one()
        invalid_sigs = (
            await db.execute(
                select(func.count(FileSignature.id))
                .join(File, File.id == FileSignature.file_id)
                .where(
                    File.owner_id == user_id,
                    FileSignature.is_valid.is_(False),
                )
            )
        ).scalar_one()
        pending_sigs = (
            await db.execute(
                select(func.count(FileSignature.id))
                .join(File, File.id == FileSignature.file_id)
                .where(
                    File.owner_id == user_id,
                    FileSignature.verified_at.is_(None),
                )
            )
        ).scalar_one()

        # Activity (actor_id or user_id for backward compat)
        uploads_30d = (
            await db.execute(
                select(func.count(AuditLog.id)).where(
                    (AuditLog.actor_id == user_id) | (AuditLog.user_id == user_id),
                    AuditLog.action == AuditAction.FILE_UPLOAD,
                    AuditLog.created_at >= last_30d,
                )
            )
        ).scalar_one()
        downloads_30d = (
            await db.execute(
                select(func.count(AuditLog.id)).where(
                    (AuditLog.actor_id == user_id) | (AuditLog.user_id == user_id),
                    AuditLog.action == AuditAction.FILE_DOWNLOAD,
                    AuditLog.created_at >= last_30d,
                )
            )
        ).scalar_one()
        logins_30d = (
            await db.execute(
                select(func.count(AuditLog.id)).where(
                    (AuditLog.actor_id == user_id) | (AuditLog.user_id == user_id),
                    AuditLog.action == AuditAction.AUTH_LOGIN,
                    AuditLog.created_at >= last_30d,
                )
            )
        ).scalar_one()

        total_size = int(sr.total_size or 0)
        avg_size = float(sr.avg_size or 0)

        return UserDashboard(
            storage=StorageStats(
                total_files=sr.total_files or 0,
                total_size_bytes=total_size,
                total_size_mb=round(total_size / 1_048_576, 2),
                largest_file_bytes=int(sr.max_size or 0),
                average_file_bytes=round(avg_size, 0),
            ),
            sharing=SharingStats(
                active_share_links=active_links,
                total_share_links=total_links,
                active_guest_sessions=active_guests,
                total_downloads_via_links=int(total_downloads or 0),
            ),
            signatures=SignatureStats(
                signed_files=signed_files,
                verified_signatures=verified_sigs,
                invalid_signatures=invalid_sigs,
                pending_verification=pending_sigs,
            ),
            activity=ActivityStats(
                uploads_last_30d=uploads_30d,
                downloads_last_30d=downloads_30d,
                logins_last_30d=logins_30d,
                failed_logins_last_30d=0,
            ),
            generated_at=now,
        )

    @staticmethod
    async def get_admin_dashboard(db: AsyncSession) -> AdminDashboard:
        now = datetime.now(timezone.utc)
        last_30d = now - timedelta(days=30)

        total_users = (
            await db.execute(select(func.count(User.id)))
        ).scalar_one()
        active_users = (
            await db.execute(
                select(func.count(func.distinct(AuditLog.actor_id))).where(
                    AuditLog.created_at >= last_30d,
                    AuditLog.actor_id.isnot(None),
                )
            )
        ).scalar_one()
        total_files = (
            await db.execute(
                select(func.count(File.id)).where(File.is_destroyed.is_(False))
            )
        ).scalar_one()
        total_storage = (
            await db.execute(
                select(func.coalesce(func.sum(File.size_bytes), 0)).where(
                    File.is_destroyed.is_(False)
                )
            )
        ).scalar_one()
        total_links = (
            await db.execute(select(func.count(ShareLink.id)))
        ).scalar_one()
        total_guests = (
            await db.execute(select(func.count(GuestSession.id)))
        ).scalar_one()

        # Top 10 users by storage
        top_q = (
            select(
                User.id,
                User.email,
                User.role,
                User.created_at,
                User.last_login_at,
                func.count(File.id).label("file_count"),
                func.coalesce(func.sum(File.size_bytes), 0).label("total_size"),
            )
            .outerjoin(
                File,
                and_(
                    File.owner_id == User.id,
                    File.is_destroyed.is_(False),
                ),
            )
            .group_by(User.id, User.email, User.role, User.created_at, User.last_login_at)
            .order_by(func.coalesce(func.sum(File.size_bytes), 0).desc())
            .limit(10)
        )
        top_result = await db.execute(top_q)
        top_rows = top_result.all()

        top_users = []
        for row in top_rows:
            active_shares = (
                await db.execute(
                    select(func.count(ShareLink.id)).where(
                        ShareLink.owner_id == row.id,
                        ShareLink.is_active.is_(True),
                    )
                )
            ).scalar_one()
            role_val = row.role.value if hasattr(row.role, "value") else str(row.role)
            top_users.append(
                UserSummary(
                    user_id=str(row.id),
                    email=row.email,
                    role=role_val,
                    total_files=row.file_count or 0,
                    total_size_bytes=int(row.total_size or 0),
                    active_shares=active_shares,
                    last_login=row.last_login_at,
                    created_at=row.created_at,
                )
            )

        uploads_30d = (
            await db.execute(
                select(func.count(AuditLog.id)).where(
                    AuditLog.action == AuditAction.FILE_UPLOAD,
                    AuditLog.created_at >= last_30d,
                )
            )
        ).scalar_one()
        downloads_30d = (
            await db.execute(
                select(func.count(AuditLog.id)).where(
                    AuditLog.action == AuditAction.FILE_DOWNLOAD,
                    AuditLog.created_at >= last_30d,
                )
            )
        ).scalar_one()

        total_size_bytes = int(total_storage or 0)
        return AdminDashboard(
            total_users=total_users,
            active_users_last_30d=active_users,
            total_files=total_files,
            total_storage_bytes=total_size_bytes,
            total_storage_gb=round(total_size_bytes / 1_073_741_824, 3),
            total_share_links=total_links,
            total_guest_sessions=total_guests,
            top_users=top_users,
            activity=ActivityStats(
                uploads_last_30d=uploads_30d,
                downloads_last_30d=downloads_30d,
                logins_last_30d=0,
                failed_logins_last_30d=0,
            ),
            generated_at=now,
        )

    @staticmethod
    async def get_time_series(
        db: AsyncSession,
        metric: str,
        days: int = 30,
        user_id: Optional[uuid.UUID] = None,
    ) -> TimeSeriesReport:
        """
        Serie temporale giornaliera per una metrica.
        metric: 'uploads'|'downloads'|'logins'|'shares'
        """
        action_map = {
            "uploads": AuditAction.FILE_UPLOAD,
            "downloads": AuditAction.FILE_DOWNLOAD,
            "logins": AuditAction.AUTH_LOGIN,
            "shares": AuditAction.SHARE_LINK_CREATE,
        }
        action = action_map.get(metric, AuditAction.FILE_UPLOAD)
        since = datetime.now(timezone.utc) - timedelta(days=days)

        day_col = func.date_trunc("day", AuditLog.created_at).label("day")
        q = (
            select(day_col, func.count(AuditLog.id).label("count"))
            .where(
                AuditLog.action == action,
                AuditLog.created_at >= since,
            )
        )
        if user_id is not None:
            q = q.where(
                (AuditLog.actor_id == user_id) | (AuditLog.user_id == user_id)
            )
        q = q.group_by(day_col).order_by(day_col)

        result = await db.execute(q)
        points = []
        for row in result.all():
            day_val = row.day
            date_str = (
                day_val.strftime("%Y-%m-%d")
                if hasattr(day_val, "strftime")
                else str(day_val)[:10]
            )
            points.append(
                TimeSeriesPoint(date=date_str, value=row.count)
            )
        return TimeSeriesReport(
            metric=metric,
            points=points,
            total=sum(p.value for p in points),
        )
