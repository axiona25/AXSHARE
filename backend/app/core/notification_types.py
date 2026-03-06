"""Costanti per tipi e severità notifiche."""


class NotificationType:
    PERMISSION_EXPIRING = "permission_expiring"
    PERMISSION_EXPIRED = "permission_expired"
    SIGNATURE_INVALID = "signature_invalid"
    GUEST_ACCESS = "guest_access"
    SHARE_LINK_ACCESSED = "share_link_accessed"
    FILE_DESTROYED = "file_destroyed"
    SECURITY_ALERT = "security_alert"
    SYNC_COMPLETE = "sync_complete"
    INVITE_RECEIVED = "invite_received"
    FILE_SHARED_WITH_ME = "file_shared_with_me"
    SHARE_REVOKED = "share_revoked"


class NotificationSeverity:
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    SUCCESS = "success"
