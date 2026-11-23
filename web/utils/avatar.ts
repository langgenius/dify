import { DEFAULT_QUERY_STALE_TIME_MS } from '@/app/get-query-client'

const avatarInitialSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const AVATAR_REFRESH_MARGIN_MS = 5 * 1000

type AvatarUrl = string | null | undefined

type QueryWithData<T> = {
  state: {
    data: T | undefined
  }
}

export const getAvatarUrlTiming = (url: AvatarUrl) => {
  if (!url) return undefined

  try {
    const parsedUrl = new URL(url, 'https://dify.invalid')
    if (!parsedUrl.pathname.endsWith('/file-preview')) return undefined

    const query = parsedUrl.searchParams
    const issuedBefore = Number(query.get('issued_before'))
    const expiresAt = Number(query.get('expires_at'))
    if (
      !Number.isSafeInteger(issuedBefore) ||
      issuedBefore <= 0 ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt < issuedBefore
    )
      return undefined

    return { issuedBefore, expiresAt }
  } catch {
    return undefined
  }
}

const getAvatarFreshness = (urls: Iterable<AvatarUrl>): number | undefined => {
  let freshness: number | undefined
  for (const url of urls) {
    const timing = getAvatarUrlTiming(url)
    if (timing) {
      // Use the latest possible issuance to allow the same refresh delay throughout the window.
      const ms = Math.max(
        0,
        (timing.expiresAt - timing.issuedBefore) * 1000 - AVATAR_REFRESH_MARGIN_MS,
      )
      freshness = freshness === undefined ? ms : Math.min(freshness, ms)
    }
  }
  return freshness
}

export function getAvatarInitial(name: string | null | undefined): string {
  for (const { segment } of avatarInitialSegmenter.segment(name?.trim() ?? ''))
    return segment.toUpperCase()
  return '?'
}

export const avatarUrlStaleTime =
  <T>(getUrls: (data: T) => Iterable<AvatarUrl>) =>
  (query: QueryWithData<T>): number => {
    if (!query.state.data) return DEFAULT_QUERY_STALE_TIME_MS

    const freshness = getAvatarFreshness(getUrls(query.state.data))
    return Math.min(DEFAULT_QUERY_STALE_TIME_MS, freshness ?? DEFAULT_QUERY_STALE_TIME_MS)
  }

export const shouldRefreshAvatarUrls = (
  urls: Iterable<AvatarUrl>,
  dataUpdatedAt: number | undefined,
  now = Date.now(),
): boolean => {
  const freshness = getAvatarFreshness(urls)
  return (
    freshness !== undefined &&
    (dataUpdatedAt === undefined || now < dataUpdatedAt || now - dataUpdatedAt >= freshness)
  )
}
