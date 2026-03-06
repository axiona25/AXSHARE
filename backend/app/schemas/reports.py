"""Schema Pydantic per reportistica e dashboard."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class StorageStats(BaseModel):
    total_files: int
    total_size_bytes: int
    total_size_mb: float
    largest_file_bytes: int
    average_file_bytes: float


class SharingStats(BaseModel):
    active_share_links: int
    total_share_links: int
    active_guest_sessions: int
    total_downloads_via_links: int


class SignatureStats(BaseModel):
    signed_files: int
    verified_signatures: int
    invalid_signatures: int
    pending_verification: int


class ActivityStats(BaseModel):
    uploads_last_30d: int
    downloads_last_30d: int
    logins_last_30d: int
    failed_logins_last_30d: int


class UserDashboard(BaseModel):
    storage: StorageStats
    sharing: SharingStats
    signatures: SignatureStats
    activity: ActivityStats
    generated_at: datetime


class UserSummary(BaseModel):
    user_id: str
    email: str
    role: str
    total_files: int
    total_size_bytes: int
    active_shares: int
    last_login: Optional[datetime] = None
    created_at: datetime


class AdminDashboard(BaseModel):
    total_users: int
    active_users_last_30d: int
    total_files: int
    total_storage_bytes: int
    total_storage_gb: float
    total_share_links: int
    total_guest_sessions: int
    top_users: List[UserSummary]
    activity: ActivityStats
    generated_at: datetime


class TimeSeriesPoint(BaseModel):
    date: str  # YYYY-MM-DD
    value: int


class TimeSeriesReport(BaseModel):
    metric: str
    points: List[TimeSeriesPoint]
    total: int
