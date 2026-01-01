import type { CommonResponse } from '@/models/common'
import { ACEDATACLOUD_OAUTH_SESSION_LOCAL_STORAGE_NAME } from '@/config'
import { get } from './base'

export type AceDataCloudOAuthUserInfo = {
  id: string
  name: string
  email: string
}

export type AceDataCloudOAuthSession = {
  provider: 'acedatacloud'
  access_token: string
  refresh_token?: string
  expires_in?: number
  obtained_at?: string
  user_info?: AceDataCloudOAuthUserInfo | null
}

type AceDataCloudOAuthSessionResponse = CommonResponse & {
  data: AceDataCloudOAuthSession | null
}

export const fetchAceDataCloudOAuthSession = async () => {
  const res = await get<AceDataCloudOAuthSessionResponse>('/oauth/acedatacloud/session', {}, { silent: true })
  return res.data
}

export const saveAceDataCloudOAuthSession = (session: AceDataCloudOAuthSession) => {
  localStorage.setItem(ACEDATACLOUD_OAUTH_SESSION_LOCAL_STORAGE_NAME, JSON.stringify(session))
}

export const loadAceDataCloudOAuthSession = (): AceDataCloudOAuthSession | null => {
  try {
    const raw = localStorage.getItem(ACEDATACLOUD_OAUTH_SESSION_LOCAL_STORAGE_NAME)
    if (!raw)
      return null
    return JSON.parse(raw) as AceDataCloudOAuthSession
  }
  catch {
    return null
  }
}

export const clearAceDataCloudOAuthSession = () => {
  localStorage.removeItem(ACEDATACLOUD_OAUTH_SESSION_LOCAL_STORAGE_NAME)
}

const parseUtcSeconds = (iso?: string) => {
  if (!iso)
    return null
  const normalized = /Z$|[+-]\\d\\d:?\\d\\d$/.test(iso) ? iso : `${iso}Z`
  const ms = Date.parse(normalized)
  if (Number.isNaN(ms))
    return null
  return Math.floor(ms / 1000)
}

export const isAceDataCloudOAuthSessionExpiringSoon = (
  session: AceDataCloudOAuthSession,
  skewSeconds = 60,
) => {
  if (!session.access_token)
    return true

  const obtainedAtSeconds = parseUtcSeconds(session.obtained_at)
  if (!obtainedAtSeconds || !session.expires_in)
    return false

  const expiresAtSeconds = obtainedAtSeconds + session.expires_in
  const nowSeconds = Math.floor(Date.now() / 1000)
  return expiresAtSeconds <= (nowSeconds + skewSeconds)
}
