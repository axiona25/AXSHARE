"""Servizio ricerca file con filtri server-side (TASK 8.2)."""

import math
import uuid
from datetime import datetime, timezone

from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.file import File
from app.models.user import User
from app.models.metadata import FileTag
from app.models.permission import Permission
from app.schemas.search import FileSearchParams, SortField, SortOrder


class SearchService:
    @staticmethod
    async def search_files(
        db: AsyncSession,
        user_id: uuid.UUID,
        params: FileSearchParams,
        is_admin: bool = False,
    ) -> dict:
        query = select(File).where(File.is_destroyed.is_(False))

        now = datetime.now(timezone.utc)
        perm_exists = (
            select(Permission.id)
            .where(
                Permission.subject_user_id == user_id,
                Permission.resource_file_id == File.id,
                Permission.is_active.is_(True),
                or_(
                    Permission.expires_at.is_(None),
                    Permission.expires_at > now,
                ),
            )
        )

        if not is_admin:
            if params.shared_with_me:
                query = query.where(exists(perm_exists))
            else:
                query = query.where(
                    or_(
                        File.owner_id == user_id,
                        exists(perm_exists),
                    )
                )
        elif params.owner_id is not None:
            query = query.where(File.owner_id == params.owner_id)

        if params.folder_id is not None:
            query = query.where(File.folder_id == params.folder_id)
        if params.mime_category:
            query = query.where(File.mime_category == params.mime_category)
        if params.is_starred is not None:
            query = query.where(File.is_starred.is_(params.is_starred))
        if params.is_pinned is not None:
            query = query.where(File.is_pinned.is_(params.is_pinned))
        if params.color_label is not None:
            query = query.where(File.color_label == params.color_label)
        if params.min_size is not None:
            query = query.where(File.size_bytes >= params.min_size)
        if params.max_size is not None:
            query = query.where(File.size_bytes <= params.max_size)
        if params.created_after is not None:
            query = query.where(File.created_at >= params.created_after)
        if params.created_before is not None:
            query = query.where(File.created_at <= params.created_before)
        if params.has_self_destruct is not None:
            if params.has_self_destruct:
                query = query.where(
                    or_(
                        File.self_destruct_after_downloads.isnot(None),
                        File.self_destruct_at.isnot(None),
                    )
                )
            else:
                query = query.where(
                    File.self_destruct_after_downloads.is_(None),
                    File.self_destruct_at.is_(None),
                )

        if params.is_signed is not None:
            query = query.where(File.is_signed.is_(params.is_signed))

        if params.tags:
            for tag in params.tags:
                t = tag.lower().strip()
                query = query.where(
                    exists(
                        select(FileTag.id).where(
                            FileTag.file_id == File.id,
                            FileTag.tag == t,
                        )
                    )
                )

        if params.tags_any:
            normalized = [t.lower().strip() for t in params.tags_any]
            query = query.where(
                exists(
                    select(FileTag.id).where(
                        FileTag.file_id == File.id,
                        FileTag.tag.in_(normalized),
                    )
                )
            )

        count_stmt = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_stmt)
        total = total_result.scalar_one() or 0

        sort_col = getattr(File, params.sort_by.value, File.created_at)
        if params.sort_order == SortOrder.desc:
            query = query.order_by(sort_col.desc())
        else:
            query = query.order_by(sort_col.asc())

        offset = (params.page - 1) * params.page_size
        query = query.offset(offset).limit(params.page_size)
        query = query.options(selectinload(File.tags))

        result = await db.execute(query)
        files = result.scalars().all()

        owner_ids = list({f.owner_id for f in files if f.owner_id != user_id})
        owner_map: dict = {}
        if owner_ids:
            owner_result = await db.execute(
                select(User.id, User.email, User.display_name_encrypted).where(User.id.in_(owner_ids))
            )
            for row in owner_result.all():
                owner_map[str(row.id)] = {"email": row.email, "display_name": row.display_name_encrypted}

        # Per shared_with_me: mappa file_id -> expires_at del permesso effettivo (priorità inherited)
        permission_expires_map: dict = {}
        if params.shared_with_me and files:
            file_ids = [f.id for f in files]
            perm_result = await db.execute(
                select(Permission)
                .where(
                    Permission.subject_user_id == user_id,
                    Permission.resource_file_id.in_(file_ids),
                    Permission.is_active.is_(True),
                    (Permission.expires_at.is_(None)) | (Permission.expires_at > now),
                )
                .order_by(Permission.resource_file_id, Permission.inherited_from_folder_id.desc().nulls_last())
            )
            for p in perm_result.scalars().all():
                if p.resource_file_id and str(p.resource_file_id) not in permission_expires_map:
                    permission_expires_map[str(p.resource_file_id)] = (
                        p.expires_at.isoformat() if p.expires_at else None
                    )

        items = []
        for f in files:
            item = {
                "id": str(f.id),
                "name_encrypted": f.name_encrypted,
                "size_bytes": f.size_bytes,
                "owner_id": str(f.owner_id),
                "folder_id": str(f.folder_id) if f.folder_id else None,
                "mime_category": f.mime_category,
                "is_starred": f.is_starred,
                "is_pinned": f.is_pinned,
                "color_label": f.color_label,
                "tags": [t.tag for t in f.tags],
                "download_count": f.download_count,
                "is_destroyed": f.is_destroyed,
                "self_destruct_after_downloads": f.self_destruct_after_downloads,
                "self_destruct_at": (
                    f.self_destruct_at.isoformat()
                    if f.self_destruct_at
                    else None
                ),
                "version": f.version,
                "created_at": f.created_at.isoformat(),
                "updated_at": f.updated_at.isoformat(),
                "owner_email": owner_map.get(str(f.owner_id), {}).get("email"),
                "owner_display_name": owner_map.get(str(f.owner_id), {}).get("display_name"),
            }
            if params.shared_with_me:
                item["permission_expires_at"] = permission_expires_map.get(str(f.id))
            items.append(item)

        return {
            "items": items,
            "total": total,
            "page": params.page,
            "page_size": params.page_size,
            "pages": math.ceil(total / params.page_size) if total > 0 else 0,
        }
