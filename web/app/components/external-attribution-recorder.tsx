'use client'

import Cookies from 'js-cookie'
import { useEffect } from 'react'
import { IS_CLOUD_EDITION } from '@/config'
import { useSearchParams } from '@/next/navigation'
import { rememberCreateAppExternalAttribution } from '@/utils/create-app-tracking'

const UTM_INFO_COOKIE = 'utm_info'
const UTM_INFO_COOKIE_EXPIRES_DAYS = 1
const UTM_INFO_QUERY_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'slug'] as const

type SearchParamReader = {
  get: (name: string) => string | null
}

const normalizeString = (value?: string | null) => {
  const trimmed = value?.trim()
  return trimmed || undefined
}

const getSearchParamValue = (searchParams: SearchParamReader, key: string) =>
  normalizeString(searchParams.get(key))

const parseRedirectUrlSearchParams = (redirectUrl: string) => {
  const baseUrl = window.location.origin

  try {
    const url = new URL(redirectUrl, baseUrl)
    if (url.origin !== baseUrl)
      return null

    return url.searchParams
  }
  catch {
    return null
  }
}

const resolveAttributionSearchParams = (searchParams: SearchParamReader): SearchParamReader | null => {
  if (getSearchParamValue(searchParams, 'utm_source'))
    return searchParams

  const redirectUrl = getSearchParamValue(searchParams, 'redirect_url')
  if (!redirectUrl)
    return null

  return parseRedirectUrlSearchParams(redirectUrl)
}

/**
 * Captures external-campaign params (utm_* + blog `slug`) from the landing URL.
 *
 * Blog links point straight at cloud.dify.ai (e.g. `/apps?utm_source=dify_blog&slug=…`),
 * bypassing the marketing site that normally seeds the `utm_info` cookie. A new visitor
 * is bounced to sign-up, and the URL params are lost on that redirect — so we persist
 * them here, on the landing render, before the redirect happens:
 *
 * - `utm_info` cookie → read by the registration trackers, so slug is reported on
 *   registration even when the user registers before creating an app.
 * - create_app sessionStorage → read by `trackCreateApp`, so slug is reported on
 *   create_app.
 *
 * slug is intentionally NOT attached to page-view events; only these conversion events.
 */
const ExternalAttributionRecorder = () => {
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!IS_CLOUD_EDITION)
      return

    const attributionSearchParams = resolveAttributionSearchParams(searchParams)
    if (!attributionSearchParams)
      return

    const utmSource = getSearchParamValue(attributionSearchParams, 'utm_source')
    if (!utmSource)
      return

    // create_app conversion attribution (utm_source + slug).
    rememberCreateAppExternalAttribution({ searchParams: attributionSearchParams })

    // Seed the utm_info cookie the registration trackers read. A campaign click always
    // overwrites any previous value, so the most recent blog link wins (last-touch) and
    // a stale cookie from an earlier, un-converted visit can't shadow the new slug. This
    // mirrors the create_app attribution refreshed just above.
    const utmInfo: Record<string, string> = {}
    UTM_INFO_QUERY_KEYS.forEach((key) => {
      const value = getSearchParamValue(attributionSearchParams, key)
      if (value)
        utmInfo[key] = value
    })

    Cookies.set(UTM_INFO_COOKIE, JSON.stringify(utmInfo), {
      expires: UTM_INFO_COOKIE_EXPIRES_DAYS,
      path: '/',
    })
  }, [searchParams])

  return null
}

export default ExternalAttributionRecorder
