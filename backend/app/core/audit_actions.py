"""
Costanti per le azioni dell'audit log.
Formato: '{resource}.{verb}'
"""


class AuditAction:
    # Auth
    AUTH_LOGIN = "auth.login"
    AUTH_LOGOUT = "auth.logout"
    AUTH_LOGIN_FAILED = "auth.login_failed"
    AUTH_TOKEN_REFRESH = "auth.token_refresh"
    AUTH_PASSWORD_CHANGE = "auth.password_change"

    # Utenti
    USER_REGISTER = "user.register"
    USER_UPDATE = "user.update"
    USER_DELETE = "user.delete"
    USER_KEY_SETUP = "user.key_setup"
    USER_SIGNING_KEY_REGISTER = "user.signing_key_register"

    # File
    FILE_UPLOAD = "file.upload"
    FILE_DOWNLOAD = "file.download"
    FILE_DELETE = "file.delete"
    FILE_RESTORE = "file.restore"
    FILE_VERSION_UPLOAD = "file.version_upload"
    FILE_VERSION_DELETE = "file.version_delete"
    FILE_SELF_DESTRUCT = "file.self_destruct"
    FILE_MOVE = "file.move"

    # Cartelle
    FOLDER_CREATE = "folder.create"
    FOLDER_DELETE = "folder.delete"
    FOLDER_RENAME = "folder.rename"

    # Permessi
    PERMISSION_GRANT = "permission.grant"
    PERMISSION_REVOKE = "permission.revoke"
    PERMISSION_EXPIRE = "permission.expire"

    # Gruppi
    GROUP_CREATE = "group.create"
    GROUP_DELETE = "group.delete"
    GROUP_MEMBER_ADD = "group.member_add"
    GROUP_MEMBER_REMOVE = "group.member_remove"

    # Condivisione
    SHARE_LINK_CREATE = "share_link.create"
    SHARE_LINK_REVOKE = "share_link.revoke"
    SHARE_LINK_ACCESS = "share_link.access"
    SHARE_LINK_ACCESS_DENIED = "share_link.access_denied"

    # Guest
    GUEST_INVITE = "guest.invite"
    GUEST_REDEEM = "guest.redeem"
    GUEST_REVOKE = "guest.revoke"

    # Firma
    FILE_SIGN = "file.sign"
    FILE_VERIFY = "file.verify"

    # Metadati
    METADATA_UPDATE = "metadata.update"
    TAG_ADD = "tag.add"
    TAG_REMOVE = "tag.remove"

    # Admin
    ADMIN_USER_LIST = "admin.user_list"
    ADMIN_USER_DISABLE = "admin.user_disable"
    ADMIN_AUDIT_EXPORT = "admin.audit_export"

    # GDPR
    GDPR_ERASURE_REQUESTED = "gdpr.erasure_requested"
