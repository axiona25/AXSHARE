/**
 * Client HTTP centralizzato per AXSHARE API.
 * - Interceptor automatico per JWT da localStorage
 * - Gestione errori uniforme con ApiError
 * - Retry automatico su 401 con refresh token
 * - NON importare questo file direttamente nei componenti — usare i hooks
 */

import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios'
import { isTauri } from '@/lib/tauri'
import {
  getAccessTokenSecure,
  getRefreshTokenSecure,
  saveTokensSecure,
  clearTokensSecure,
} from '@/lib/auth'
import type {
  ApiError,
  AuthTokens,
  FileItem,
  FileVersion,
  Folder,
  Group,
  Permission,
  PermissionLevel,
  UploadMetadata,
  User,
  WebAuthnRegisterBeginResponse,
} from '@/types'

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (typeof window !== 'undefined') {
      const token = isTauri()
        ? await getAccessTokenSecure()
        : localStorage.getItem('axshare_access_token')
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
    }
    return config
  },
  (error) => Promise.reject(error)
)

let isRefreshing = false
const failedQueue: Array<{
  resolve: (token: string) => void
  reject: (err: unknown) => void
}> = []

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((p) => {
    if (error) p.reject(error)
    else if (token) p.resolve(token)
  })
  failedQueue.length = 0
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return apiClient(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const refreshToken = isTauri()
          ? await getRefreshTokenSecure()
          : localStorage.getItem('axshare_refresh_token')
        if (!refreshToken) throw new Error('No refresh token')

        const currentAccess = isTauri()
          ? await getAccessTokenSecure()
          : localStorage.getItem('axshare_access_token')

        const response = await axios.post<AuthTokens>(
          `${BASE_URL}/auth/token/refresh`,
          { refresh_token: refreshToken },
          {
            headers: {
              Authorization: `Bearer ${currentAccess ?? ''}`,
            },
          }
        )

        const { access_token } = response.data
        await saveTokensSecure(access_token)
        apiClient.defaults.headers.common.Authorization = `Bearer ${access_token}`
        processQueue(null, access_token)
        originalRequest.headers.Authorization = `Bearer ${access_token}`
        return apiClient(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        await clearTokensSecure()
        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    const apiError: ApiError = {
      detail:
        (error.response?.data as { detail?: string })?.detail ||
        error.message ||
        'Errore sconosciuto',
      status: error.response?.status || 0,
    }
    return Promise.reject(apiError)
  }
)

// ─── Auth API ────────────────────────────────────────────────────────────────

export const authApi = {
  webauthnRegisterBegin: (email: string, displayName?: string) =>
    apiClient.post<WebAuthnRegisterBeginResponse>(
      '/auth/webauthn/register/begin',
      { email, ...(displayName != null && displayName !== '' && { display_name: displayName }) }
    ),

  webauthnRegisterComplete: (email: string, credential: unknown) =>
    apiClient.post('/auth/webauthn/register/complete', { email, credential }),

  webauthnAuthBegin: (email: string) =>
    apiClient.post('/auth/webauthn/authenticate/begin', { email }),

  webauthnAuthComplete: (email: string, credential: unknown) =>
    apiClient.post<AuthTokens>('/auth/webauthn/authenticate/complete', {
      email,
      credential,
    }),

  getWebAuthnCredentials: () =>
    apiClient.get<{ credentials: Array<{ id: string; display_name: string; created_at?: string; last_used_at?: string | null; aaguid?: string }> }>('/auth/webauthn/credentials'),

  deleteWebAuthnCredential: (credentialId: string) =>
    apiClient.delete(`/auth/webauthn/credentials/${encodeURIComponent(credentialId)}`),

  totpSetup: () =>
    apiClient.post<{ secret: string; qr_uri: string }>('/auth/totp/setup'),

  totpVerify: (code: string) =>
    apiClient.post('/auth/totp/verify', { code }),

  refreshToken: (refreshToken: string) =>
    apiClient.post<AuthTokens>('/auth/token/refresh', {
      refresh_token: refreshToken,
    }),
}

// ─── Users API ───────────────────────────────────────────────────────────────

export const usersApi = {
  getMe: () => apiClient.get<User>('/users/me'),

  updateMe: (data: { display_name?: string }) =>
    apiClient.put<User>('/users/me', data),

  uploadPublicKey: (publicKeyPem: string) =>
    apiClient.post('/users/me/public-key', { public_key_pem: publicKeyPem }),

  getPublicKey: (userId: string) =>
    apiClient.get<{ public_key_pem: string }>(
      `/users/${userId}/public-key`
    ),

  registerSigningKey: (signingPublicKeyPem: string) =>
    apiClient.post<{ message: string; registered_at: string }>(
      '/users/me/signing-key',
      { signing_public_key_pem: signingPublicKeyPem }
    ),

  getSigningKeyStatus: () =>
    apiClient.get<{
      has_signing_key: boolean
      registered_at: string | null
    }>('/users/me/signing-key'),

  getUserSigningKey: (userId: string) =>
    apiClient.get<{
      user_id: string
      signing_public_key_pem: string | null
      registered_at: string | null
    }>(`/users/${userId}/signing-key`),
}

// ─── Share Links API (TASK 10.1) ──────────────────────────────────────────────

export interface ShareLinkData {
  id: string
  file_id: string
  token: string
  is_password_protected: boolean
  expires_at: string | null
  max_downloads: number | null
  download_count: number
  is_active: boolean
  label: string | null
  created_at: string
  share_url: string
}

export interface PublicShareInfo {
  token: string
  is_password_protected: boolean
  expires_at: string | null
  max_downloads: number | null
  download_count: number
  label: string | null
}

export const shareLinksApi = {
  create: (
    fileId: string,
    payload: {
      file_key_encrypted_for_link?: string
      password?: string
      expires_at?: string
      max_downloads?: number
      label?: string
    }
  ) => apiClient.post<ShareLinkData>(`/files/${fileId}/share-links`, payload),

  list: (fileId: string) =>
    apiClient.get<ShareLinkData[]>(`/files/${fileId}/share-links`),

  revoke: (linkId: string) => apiClient.delete(`/share-links/${linkId}`),

  getPublicInfo: (token: string) =>
    apiClient.get<PublicShareInfo>(`/public/share/${token}`),

  downloadViaLink: (token: string, password?: string) =>
    apiClient.post<{
      file_id: string
      name_encrypted: string
      file_key_encrypted_for_link: string | null
      encryption_iv: string
      size_bytes: number
      download_count: number
    }>(`/public/share/${token}/download`, { password }),
}

// ─── Guest Sessions API (TASK 10.2) ───────────────────────────────────────────

export interface GuestSessionData {
  id: string
  guest_email: string
  expires_at: string
  is_active: boolean
  label: string | null
  invite_used: boolean
  created_at: string
  accessible_files: string[]
}

export const guestApi = {
  createInvite: (payload: {
    guest_email: string
    file_ids: string[]
    file_keys_encrypted?: string[]
    expires_in_hours?: number
    label?: string
    can_download?: boolean
    can_preview?: boolean
  }) => apiClient.post<GuestSessionData & { invite_token?: string }>('/guest/invite', payload),

  listSessions: () =>
    apiClient.get<GuestSessionData[]>('/guest/sessions'),

  revokeSession: (sessionId: string) =>
    apiClient.delete(`/guest/sessions/${sessionId}`),

  redeemInvite: (inviteToken: string) =>
    apiClient.post<{
      access_token: string
      expires_at: string
      guest_email: string
      accessible_files: string[]
    }>(`/public/guest/redeem?invite_token=${encodeURIComponent(inviteToken)}`),
}

// ─── Files API ────────────────────────────────────────────────────────────────

export const filesApi = {
  upload: (encryptedBlob: Blob, metadata: UploadMetadata) => {
    const formData = new FormData()
    formData.append('file', encryptedBlob, 'encrypted_blob')
    formData.append('metadata', JSON.stringify(metadata))
    return apiClient.post<{ file_id: string }>('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  getMeta: (fileId: string) =>
    apiClient.get<FileItem>(`/files/${fileId}`),

  get: (fileId: string) =>
    apiClient.get<{ id: string; current_version: number; [key: string]: unknown }>(
      `/files/${fileId}`
    ),

  download: (fileId: string) =>
    apiClient.get<ArrayBuffer>(`/files/${fileId}/download`, {
      responseType: 'arraybuffer',
    }),

  getKey: (fileId: string) =>
    apiClient.get<{ file_key_encrypted: string; encryption_iv: string }>(
      `/files/${fileId}/key`
    ),

  uploadVersion: (
    fileId: string,
    encryptedBlob: Blob,
    metadata: UploadMetadata
  ) => {
    const formData = new FormData()
    formData.append('file', encryptedBlob, 'encrypted_blob')
    formData.append('metadata', JSON.stringify(metadata))
    return apiClient.post<{ version: number }>(
      `/files/${fileId}/version`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
  },

  listVersions: (fileId: string) =>
    apiClient.get<FileVersion[]>(`/files/${fileId}/versions`),

  restoreVersion: (fileId: string, versionNumber: number) =>
    apiClient.post(
      `/files/${fileId}/versions/${versionNumber}/restore`
    ),

  shareWithGroup: (
    fileId: string,
    groupId: string,
    fileKeyEncrypted: string,
    level: PermissionLevel = 'read'
  ) =>
    apiClient.post(`/files/${fileId}/share-group`, {
      group_id: groupId,
      file_key_encrypted_for_group: fileKeyEncrypted,
      level,
    }),

  setSelfDestruct: (
    fileId: string,
    afterDownloads?: number,
    destructAt?: string
  ) =>
    apiClient.post(`/files/${fileId}/self-destruct`, {
      after_downloads: afterDownloads,
      destruct_at: destructAt,
    }),

  destroy: (fileId: string) => apiClient.delete(`/files/${fileId}/destroy`),
}

// ─── Folders API ─────────────────────────────────────────────────────────────

export const foldersApi = {
  create: (
    nameEncrypted: string,
    parentId?: string,
    folderKeyEncrypted?: string
  ) =>
    apiClient.post<{ folder_id: string }>('/folders/', {
      name_encrypted: nameEncrypted,
      parent_id: parentId,
      folder_key_encrypted: folderKeyEncrypted,
    }),

  listRoot: () => apiClient.get<Folder[]>('/folders/'),

  listChildren: (folderId: string) =>
    apiClient.get<Folder[]>(`/folders/${folderId}/children`),

  listFiles: (folderId: string) =>
    apiClient.get<FileItem[]>(`/folders/${folderId}/files`),
}

// ─── Permissions API ─────────────────────────────────────────────────────────

export const permissionsApi = {
  grant: (data: {
    subject_user_id: string
    resource_file_id?: string
    resource_folder_id?: string
    level: PermissionLevel
    resource_key_encrypted?: string
    expires_at?: string
  }) => apiClient.post<Permission>('/permissions/', data),

  revoke: (permissionId: string) =>
    apiClient.delete(`/permissions/${permissionId}`),

  listForFile: (fileId: string) =>
    apiClient.get<Permission[]>(`/permissions/file/${fileId}`),

  listExpiringSoon: (hours = 24) =>
    apiClient.get<Permission[]>(
      `/permissions/expiring-soon?hours=${hours}`
    ),
}

// ─── Groups API ───────────────────────────────────────────────────────────────

export const groupsApi = {
  create: (name: string, description?: string) =>
    apiClient.post<{ id: string; name: string }>('/groups/', {
      name,
      description,
    }),

  list: () => apiClient.get<Group[]>('/groups/'),

  addMember: (
    groupId: string,
    userId: string,
    encryptedGroupKey: string
  ) =>
    apiClient.post(`/groups/${groupId}/members`, {
      user_id: userId,
      encrypted_group_key: encryptedGroupKey,
    }),

  removeMember: (groupId: string, userId: string) =>
    apiClient.delete(`/groups/${groupId}/members/${userId}`),
}

// ─── Search API (TASK 8.2) ─────────────────────────────────────────────────

export const searchApi = {
  searchFiles: (params: Record<string, unknown>) =>
    apiClient.get<{
      items: unknown[]
      total: number
      page: number
      page_size: number
      pages: number
    }>('/search/files', { params }),

  suggestTags: (q: string) =>
    apiClient.get<{ tag: string; count: number }[]>(
      '/search/tags/suggest',
      { params: { q } }
    ),
}

// ─── Thumbnail API (TASK 8.3) ───────────────────────────────────────────────

export const thumbnailApi = {
  upload: (
    fileId: string,
    thumbnailEncrypted: string,
    thumbnailKeyEncrypted: string
  ) =>
    apiClient.put(`/files/${fileId}/thumbnail`, {
      thumbnail_encrypted: thumbnailEncrypted,
      thumbnail_key_encrypted: thumbnailKeyEncrypted,
    }),

  get: (fileId: string) =>
    apiClient.get<{
      file_id: string
      thumbnail_encrypted: string
      thumbnail_key_encrypted: string | null
    }>(`/files/${fileId}/thumbnail`),
}

// ─── Signatures API (TASK 9.1 / 9.2) ─────────────────────────────────────────

export const signaturesApi = {
  sign: (
    fileId: string,
    payload: {
      version: number
      signature_b64: string
      file_hash_sha256: string
      public_key_pem_snapshot: string
      algorithm?: string
    }
  ) => apiClient.post(`/files/${fileId}/sign`, payload),

  list: (fileId: string) =>
    apiClient.get<unknown[]>(`/files/${fileId}/signatures`),

  verify: (fileId: string, version: number) =>
    apiClient.post<{
      file_id: string
      version: number
      is_valid: boolean
      signer_email: string | null
      verified_at: string
      message: string
    }>(`/files/${fileId}/verify/${version}`),
}

// ─── Reports / Dashboard (TASK 11.2) ────────────────────────────────────────

export interface UserDashboard {
  storage: {
    total_files: number
    total_size_bytes: number
    total_size_mb: number
    largest_file_bytes: number
    average_file_bytes: number
  }
  sharing: {
    active_share_links: number
    total_share_links: number
    active_guest_sessions: number
    total_downloads_via_links: number
  }
  signatures: {
    signed_files: number
    verified_signatures: number
    invalid_signatures: number
    pending_verification: number
  }
  activity: {
    uploads_last_30d: number
    downloads_last_30d: number
    logins_last_30d: number
    failed_logins_last_30d: number
  }
  generated_at: string
}

export interface UserSummary {
  user_id: string
  email: string
  role: string
  total_files: number
  total_size_bytes: number
  active_shares: number
  last_login: string | null
  created_at: string
}

export interface AdminDashboard {
  total_users: number
  active_users_last_30d: number
  total_files: number
  total_storage_bytes: number
  total_storage_gb: number
  total_share_links: number
  total_guest_sessions: number
  top_users: UserSummary[]
  activity: {
    uploads_last_30d: number
    downloads_last_30d: number
    logins_last_30d: number
    failed_logins_last_30d: number
  }
  generated_at: string
}

export interface TimeSeriesReport {
  metric: string
  points: { date: string; value: number }[]
  total: number
}

export const reportsApi = {
  getMyDashboard: () =>
    apiClient.get<UserDashboard>('/audit/dashboard/me'),

  getAdminDashboard: () =>
    apiClient.get<AdminDashboard>('/audit/dashboard/admin'),

  getTimeSeries: (metric: string, days = 30) =>
    apiClient.get<TimeSeriesReport>('/audit/dashboard/timeseries', {
      params: { metric, days },
    }),

  getAuditLogs: (params?: Record<string, unknown>) =>
    apiClient.get('/audit/logs', { params }),

  exportCsv: (params?: Record<string, unknown>) =>
    apiClient.get('/audit/logs/export/csv', {
      params,
      responseType: 'blob',
    }),
}

// ─── Notifications (TASK 11.3) ─────────────────────────────────────────────

export const notificationsApi = {
  list: (params?: {
    unread_only?: boolean
    page?: number
    page_size?: number
  }) => apiClient.get<{ items: NotificationItem[]; unread_count: number }>('/notifications', { params }),

  getCount: () =>
    apiClient.get<{ unread_count: number }>('/notifications/count'),

  markRead: (ids?: string[]) =>
    apiClient.post('/notifications/read', ids ? { notification_ids: ids } : {}),
}

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  resource_type: string | null
  resource_id: string | null
  action_url: string | null
  is_read: boolean
  severity: string
  created_at: string | null
}
