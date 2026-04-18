import Cookies from 'js-cookie'
import { trackEvent } from '@/app/components/base/amplitude'
import { AppModeEnum } from '@/types/app'

const CREATE_APP_EXTERNAL_ATTRIBUTION_STORAGE_KEY = 'create_app_external_attribution'
const CREATE_APP_EXTERNAL_ATTRIBUTION_QUERY_KEYS = ['utm_source', 'utm_campaign', 'slug'] as const

const EXTERNAL_UTM_SOURCE_MAP = {
  blog: 'blog',
  dify_blog: 'blog',
  linkedin: 'linkedin',
  newsletter: 'blog',
  twitter: 'twitter/x',
  x: 'twitter/x',
} as const

type SearchParamReader = {
  get: (name: string) => string | null
}

type OriginalCreateAppMode = 'workflow' | 'chatflow' | 'agent'

type TrackCreateAppParams = {
  appMode: AppModeEnum
}

type ExternalCreateAppAttribution = {
  utmSource: typeof EXTERNAL_UTM_SOURCE_MAP[keyof typeof EXTERNAL_UTM_SOURCE_MAP]
  utmCampaign?: string
}

const serializeBootstrapValue = (value: unknown) => {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

const normalizeString = (value?: string | null) => {
  const trimmed = value?.trim()
  return trimmed || undefined
}

const getObjectStringValue = (value: unknown) => {
  return typeof value === 'string' ? normalizeString(value) : undefined
}

const getSearchParamValue = (searchParams?: SearchParamReader | null, key?: string) => {
  if (!searchParams || !key)
    return undefined
  return normalizeString(searchParams.get(key))
}

const parseJSONRecord = (value?: string | null): Record<string, unknown> | null => {
  if (!value)
    return null

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  }
  catch {
    return null
  }
}

const getCookieUtmInfo = () => {
  return parseJSONRecord(Cookies.get('utm_info'))
}

const mapExternalUtmSource = (value?: string) => {
  if (!value)
    return undefined

  const normalized = value.toLowerCase()
  return EXTERNAL_UTM_SOURCE_MAP[normalized as keyof typeof EXTERNAL_UTM_SOURCE_MAP]
}

const padTimeValue = (value: number) => String(value).padStart(2, '0')

const formatCreateAppTime = (date: Date) => {
  return `${padTimeValue(date.getMonth() + 1)}-${padTimeValue(date.getDate())}-${padTimeValue(date.getHours())}:${padTimeValue(date.getMinutes())}:${padTimeValue(date.getSeconds())}`
}

const mapOriginalCreateAppMode = (appMode: AppModeEnum): OriginalCreateAppMode => {
  if (appMode === AppModeEnum.WORKFLOW)
    return 'workflow'

  if (appMode === AppModeEnum.AGENT_CHAT)
    return 'agent'

  return 'chatflow'
}

export const runCreateAppAttributionBootstrap = (
  sourceMap = EXTERNAL_UTM_SOURCE_MAP,
  storageKey = CREATE_APP_EXTERNAL_ATTRIBUTION_STORAGE_KEY,
  queryKeys = CREATE_APP_EXTERNAL_ATTRIBUTION_QUERY_KEYS,
) => {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage)
      return

    const searchParams = new URLSearchParams(window.location.search)
    const rawSource = searchParams.get('utm_source')

    if (!rawSource)
      return

    const normalizedSource = rawSource.trim().toLowerCase()
    const mappedSource = sourceMap[normalizedSource as keyof typeof sourceMap]

    if (!mappedSource)
      return

    const normalizedSlug = searchParams.get('slug')?.trim()
    const normalizedCampaign = searchParams.get('utm_campaign')?.trim()
    const utmCampaign = normalizedSlug || normalizedCampaign
    const attribution = utmCampaign
      ? { utmSource: mappedSource, utmCampaign }
      : { utmSource: mappedSource }

    window.sessionStorage.setItem(storageKey, JSON.stringify(attribution))

    const nextSearchParams = new URLSearchParams(window.location.search)
    let hasChanges = false

    queryKeys.forEach((key) => {
      if (!nextSearchParams.has(key))
        return

      nextSearchParams.delete(key)
      hasChanges = true
    })

    if (!hasChanges)
      return

    const nextSearch = nextSearchParams.toString()
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`

    try {
      window.history.replaceState(window.history.state, '', nextUrl)
    }
    catch {}
  }
  catch {}
}

export const buildCreateAppAttributionBootstrapScript = () => {
  return `(${runCreateAppAttributionBootstrap.toString()})(${serializeBootstrapValue(EXTERNAL_UTM_SOURCE_MAP)}, ${serializeBootstrapValue(CREATE_APP_EXTERNAL_ATTRIBUTION_STORAGE_KEY)}, ${serializeBootstrapValue(CREATE_APP_EXTERNAL_ATTRIBUTION_QUERY_KEYS)});`
}

export const extractExternalCreateAppAttribution = ({
  searchParams,
  utmInfo,
}: {
  searchParams?: SearchParamReader | null
  utmInfo?: Record<string, unknown> | null
}) => {
  const rawSource = getSearchParamValue(searchParams, 'utm_source') ?? getObjectStringValue(utmInfo?.utm_source)
  const mappedSource = mapExternalUtmSource(rawSource)

  if (!mappedSource)
    return null

  const utmCampaign = getSearchParamValue(searchParams, 'slug')
    ?? getSearchParamValue(searchParams, 'utm_campaign')
    ?? getObjectStringValue(utmInfo?.slug)
    ?? getObjectStringValue(utmInfo?.utm_campaign)

  return {
    utmSource: mappedSource,
    ...(utmCampaign ? { utmCampaign } : {}),
  } satisfies ExternalCreateAppAttribution
}

const readRememberedExternalCreateAppAttribution = (): ExternalCreateAppAttribution | null => {
  return parseJSONRecord(window.sessionStorage.getItem(CREATE_APP_EXTERNAL_ATTRIBUTION_STORAGE_KEY)) as ExternalCreateAppAttribution | null
}

const writeRememberedExternalCreateAppAttribution = (attribution: ExternalCreateAppAttribution) => {
  window.sessionStorage.setItem(CREATE_APP_EXTERNAL_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution))
}

const clearRememberedExternalCreateAppAttribution = () => {
  window.sessionStorage.removeItem(CREATE_APP_EXTERNAL_ATTRIBUTION_STORAGE_KEY)
}

export const rememberCreateAppExternalAttribution = ({
  searchParams,
  utmInfo,
}: {
  searchParams?: SearchParamReader | null
  utmInfo?: Record<string, unknown> | null
} = {}) => {
  const attribution = extractExternalCreateAppAttribution({
    searchParams,
    utmInfo: utmInfo ?? getCookieUtmInfo(),
  })

  if (attribution && typeof window !== 'undefined')
    writeRememberedExternalCreateAppAttribution(attribution)

  return attribution
}

const resolveCurrentExternalCreateAppAttribution = () => {
  if (typeof window === 'undefined')
    return null

  return readRememberedExternalCreateAppAttribution()
}

export const buildCreateAppEventPayload = (
  params: TrackCreateAppParams,
  externalAttribution?: ExternalCreateAppAttribution | null,
  currentTime = new Date(),
) => {
  if (externalAttribution) {
    return {
      source: 'external',
      utm_source: externalAttribution.utmSource,
      ...(externalAttribution.utmCampaign ? { utm_campaign: externalAttribution.utmCampaign } : {}),
    } satisfies Record<string, string>
  }

  return {
    source: 'original',
    app_mode: mapOriginalCreateAppMode(params.appMode),
    time: formatCreateAppTime(currentTime),
  } satisfies Record<string, string>
}

export const trackCreateApp = (params: TrackCreateAppParams) => {
  const externalAttribution = resolveCurrentExternalCreateAppAttribution()
  const payload = buildCreateAppEventPayload(params, externalAttribution)

  if (externalAttribution)
    clearRememberedExternalCreateAppAttribution()

  trackEvent('create_app', payload)
}
