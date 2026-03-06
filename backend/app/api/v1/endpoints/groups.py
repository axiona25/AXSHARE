"""Gestione gruppi con distribuzione chiavi condivise E2E."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.group import Group, GroupMember, GroupRole
from app.models.user import User

router = APIRouter(prefix="/groups", tags=["groups"])


class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = None
    group_public_key: Optional[str] = None  # Chiave pubblica del gruppo (non persistita nel modello attuale)


class AddMemberRequest(BaseModel):
    user_id: uuid.UUID
    encrypted_group_key: str  # Chiave gruppo cifrata con pubkey del nuovo membro


@router.post("/")
async def create_group(
    payload: GroupCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Crea un gruppo; l'owner è automaticamente membro con ruolo OWNER."""
    group = Group(
        name_encrypted=payload.name,
        description_encrypted=payload.description,
        owner_id=current_user.id,
    )
    db.add(group)
    await db.flush()
    membership = GroupMember(
        group_id=group.id,
        user_id=current_user.id,
        role=GroupRole.OWNER,
        encrypted_group_key="",  # Owner ha già la chiave lato client
    )
    db.add(membership)
    await db.commit()
    await db.refresh(group)
    return {"id": str(group.id), "name": group.name_encrypted}


@router.get("/")
async def list_my_groups(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista i gruppi di cui l'utente è membro."""
    result = await db.execute(
        select(Group)
        .join(GroupMember)
        .where(GroupMember.user_id == current_user.id)
        .distinct()
    )
    groups = result.scalars().all()
    return [{"id": str(g.id), "name": g.name_encrypted} for g in groups]


@router.post("/{group_id}/members")
async def add_member(
    group_id: uuid.UUID,
    req: AddMemberRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aggiunge un membro al gruppo; solo OWNER/ADMIN del gruppo possono farlo."""
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
            GroupMember.role.in_([GroupRole.OWNER, GroupRole.ADMIN]),
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=403,
            detail="Solo admin del gruppo possono aggiungere membri",
        )
    membership = GroupMember(
        group_id=group_id,
        user_id=req.user_id,
        role=GroupRole.MEMBER,
        encrypted_group_key=req.encrypted_group_key,
    )
    db.add(membership)
    await db.commit()
    return {"status": "member_added"}


@router.delete("/{group_id}/members/{user_id}")
async def remove_member(
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rimuove un membro dal gruppo; solo OWNER/ADMIN possono farlo."""
    admin_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == current_user.id,
            GroupMember.role.in_([GroupRole.OWNER, GroupRole.ADMIN]),
        )
    )
    if not admin_result.scalar_one_or_none():
        raise HTTPException(
            status_code=403,
            detail="Solo admin del gruppo possono rimuovere membri",
        )
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Membro non trovato")
    await db.delete(membership)
    await db.commit()
    return {"status": "member_removed"}
