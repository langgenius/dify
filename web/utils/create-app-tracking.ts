import Cookies from 'js-cookie'
import { trackEvent } from '@/app/components/base/amplitude'

const CREATE_APP_EXTERNAL_ATTRIBUTION_STORAGE_KEY = 'create_app_external_attribution'

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

type CreateAppSource = 'external' | 'explore_template_list' | 'explore_template_preview' | 'studio_blank' | 'studio_template_list' | 'studio_template_preview' | 'studio_upload'

type TemplateCreateAppSource = Extract<CreateAppSource, 'explore_template_list' | 'explore_template_preview' | 'studio_template_list' | 'studio_template_preview'>

type NonTemplateCreateAppSource = Extract<CreateAppSource, 'studio_blank' | 'studio_upload'>

type TrackCreateAppParams = { source: TemplateCreateAppSource, templateId: string } | { source: NonTemplateCreateAppSource }

type ExternalCreateAppAttribution = {
  utmSource: typeof EXTERNAL_UTM_SOURCE_MAP[keyof typeof EXTERNAL_UTM_SOURCE_MAP]
  utmCampaign?: string
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
  if (typeof window === 'undefined')
    return null

  return parseJSONRecord(window.sessionStorage.getItem(CREATE_APP_EXTERNAL_ATTRIBUTION_STORAGE_KEY)) as ExternalCreateAppAttribution | null
}

const writeRememberedExternalCreateAppAttribution = (attribution: ExternalCreateAppAttribution) => {
  if (typeof window === 'undefined')
    return

  window.sessionStorage.setItem(CREATE_APP_EXTERNAL_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution))
}

const clearRememberedExternalCreateAppAttribution = () => {
  if (typeof window === 'undefined')
    return

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

  if (attribution)
    writeRememberedExternalCreateAppAttribution(attribution)

  return attribution
}

const resolveCurrentExternalCreateAppAttribution = () => {
  if (typeof window === 'undefined')
    return null

  return rememberCreateAppExternalAttribution({
    searchParams: new URLSearchParams(window.location.search),
  }) ?? readRememberedExternalCreateAppAttribution()
}

export const buildCreateAppEventPayload = (
  params: TrackCreateAppParams,
  externalAttribution?: ExternalCreateAppAttribution | null,
) => {
  if (externalAttribution) {
    return {
      source: 'external',
      utm_source: externalAttribution.utmSource,
      ...(externalAttribution.utmCampaign ? { utm_campaign: externalAttribution.utmCampaign } : {}),
    } satisfies Record<string, string>
  }

  if ('templateId' in params) {
    return {
      source: params.source,
      template_id: params.templateId,
    } satisfies Record<string, string>
  }

  return {
    source: params.source,
  } satisfies Record<string, string>
}

export const trackCreateApp = (params: TrackCreateAppParams) => {
  const externalAttribution = resolveCurrentExternalCreateAppAttribution()
  const payload = buildCreateAppEventPayload(params, externalAttribution)

  if (externalAttribution)
    clearRememberedExternalCreateAppAttribution()

  trackEvent('create_app', payload)
}
