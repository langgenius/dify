import type { Fetcher } from 'swr'
import { del, get, post } from './base'

export type WorkspaceApiKey = {
  id: string
  name: string
  token?: string
  type: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  is_expired: boolean
  created_by: string
}

export type WorkspaceApiKeyListResponse = {
  data: WorkspaceApiKey[]
}

export type WorkspaceApiKeyCreateResponse = {
  id: string
  name: string
  token: string
  type: string
  scopes: string[]
  created_at: string
  expires_at: string | null
}

export type ScopeCategory = {
  name: string
  scopes: string[]
}

export type WorkspaceApiKeyScopesResponse = {
  categories: Record<string, ScopeCategory>
  scopes: Record<string, string>
}

/**
 * Fetch workspace API keys
 */
export const fetchWorkspaceApiKeys: Fetcher<WorkspaceApiKeyListResponse, { url: string }> = ({ url }) => {
  return get<WorkspaceApiKeyListResponse>(url)
}

/**
 * Create a workspace API key
 */
export const createWorkspaceApiKey: Fetcher<WorkspaceApiKeyCreateResponse, {
  name: string
  scopes?: string[]
  expiresInDays?: number
}> = ({ name, scopes = [], expiresInDays = 30 }) => {
  const payload = {
    name,
    scopes,
    expires_in_days: expiresInDays,
  }
  return post<WorkspaceApiKeyCreateResponse>('/workspaces/current/api-keys', { body: payload })
}

/**
 * Regenerate a workspace API key
 */
export const regenerateWorkspaceApiKey: Fetcher<WorkspaceApiKeyCreateResponse, { keyId: string }> = ({ keyId }) => {
  return post<WorkspaceApiKeyCreateResponse>(`/workspaces/current/api-keys/${keyId}/regenerate`, { body: {} })
}

/**
 * Delete a workspace API key
 */
export const deleteWorkspaceApiKey: Fetcher<{ message: string }, { keyId: string }> = ({ keyId }) => {
  return del<{ message: string }>(`/workspaces/current/api-keys/${keyId}`)
}

/**
 * Update a workspace API key
 */
export const updateWorkspaceApiKey: Fetcher<WorkspaceApiKey, {
  keyId: string
  name?: string
  scopes?: string[]
  expiresInDays?: number
}> = ({ keyId, name, scopes, expiresInDays }) => {
  const payload: any = {}
  if (name !== undefined) payload.name = name
  if (scopes !== undefined) payload.scopes = scopes
  if (expiresInDays !== undefined) payload.expires_in_days = expiresInDays
  return post<WorkspaceApiKey>(`/workspaces/current/api-keys/${keyId}`, { body: payload })
}

/**
 * Fetch available scopes for workspace API keys
 */
export const fetchWorkspaceApiKeyScopes: Fetcher<WorkspaceApiKeyScopesResponse, { url: string }> = ({ url }) => {
  return get<WorkspaceApiKeyScopesResponse>(url)
}
