export type UserRole = 'user' | 'admin' | 'guest'
export type PermissionLevel = 'read' | 'write' | 'share' | 'admin'
export type GroupRole = 'owner' | 'admin' | 'member'

export interface User {
  id: string
  email: string
  display_name: string
  role: UserRole
  totp_enabled: boolean
  has_public_key: boolean
  created_at: string
}

export interface FileItem {
  id: string
  name_encrypted: string
  mime_type_encrypted: string
  size_bytes: number
  owner_id: string
  folder_id: string | null
  current_version: number
  download_count: number
  is_destroyed: boolean
  self_destruct_after_downloads: number | null
  self_destruct_at: string | null
  created_at: string
  updated_at: string
}

export interface Folder {
  id: string
  name_encrypted: string
  parent_id: string | null
  owner_id: string
  is_destroyed: boolean
  created_at: string
}

export interface Permission {
  id: string
  subject_user_id: string
  resource_file_id: string | null
  resource_folder_id: string | null
  level: PermissionLevel
  expires_at: string | null
  is_active: boolean
  granted_by_id: string
  resource_key_encrypted: string | null
}

export interface Group {
  id: string
  name: string
  description: string | null
  owner_id: string
  created_at: string
}

export interface GroupMember {
  id: string
  group_id: string
  user_id: string
  role: GroupRole
  encrypted_group_key: string
}

export interface FileVersion {
  version_number: number
  created_at: string
  size_bytes: number
}

export interface ApiError {
  detail: string
  status: number
}

export interface AuthTokens {
  access_token: string
  token_type: string
}

export interface JWTPayload {
  sub: string
  role: UserRole
  exp: number
  iat: number
  type: 'access' | 'refresh'
}

export interface UploadMetadata {
  name_encrypted: string
  mime_type_encrypted: string
  file_key_encrypted: string
  encryption_iv: string
  size: number
  folder_id?: string
}

export interface WebAuthnRegisterBeginResponse {
  challenge: string
  rp: { name: string; id: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: unknown[]
  timeout: number
  attestation: string
}
