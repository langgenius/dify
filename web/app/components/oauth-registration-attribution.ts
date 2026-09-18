import Cookies from 'js-cookie'
import { sendGAEvent } from '@/utils/gtag'
import {
  ATTRIBUTION_KEYS,
  hasSentOAuthRegistrationGA,
  markOAuthRegistrationGASent,
} from './base/amplitude/registration-session-state'
import {
  normalizeRegistrationAttribution,
  rememberRegistrationSuccess,
} from './base/amplitude/registration-tracking'

export const OAUTH_NEW_USER_PARAM = 'oauth_new_user'

type SearchParamReader = {
  get: (name: string) => string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readSearchParamAttribution = (searchParams: SearchParamReader) => {
  const attribution: Record<string, string> = {}
  ATTRIBUTION_KEYS.forEach((key) => {
    const value = searchParams.get(key)?.trim()
    if (value) attribution[key] = value
  })
  return attribution
}

const parseCookieUtmInfo = (raw: string | undefined) => {
  if (!raw) return {} as Record<string, unknown>

  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch (e) {
    console.error('Failed to parse utm_info cookie:', e)
    return {} as Record<string, unknown>
  }
}

export const readOAuthRegistrationAttribution = ({
  cookieValue,
  searchParams,
}: {
  cookieValue?: string
  searchParams: SearchParamReader
}) => {
  const merged = {
    ...parseCookieUtmInfo(cookieValue),
    ...readSearchParamAttribution(searchParams),
  }
  return normalizeRegistrationAttribution(Object.keys(merged).length ? merged : null)
}

export const reportOAuthRegistrationIfNewUser = (searchParams: SearchParamReader) => {
  if (searchParams.get(OAUTH_NEW_USER_PARAM) !== 'true') return false

  const utmInfo = readOAuthRegistrationAttribution({
    cookieValue: Cookies.get('utm_info'),
    searchParams,
  })
  const eventName = utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success'
  if (!hasSentOAuthRegistrationGA()) {
    sendGAEvent(eventName, {
      method: 'oauth',
      ...utmInfo,
    })
    markOAuthRegistrationGASent()
  }
  return rememberRegistrationSuccess({ method: 'oauth', utmInfo })
}
