const avatarInitialSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const ACCOUNT_AVATAR_NONCE_PREFIX = 'account-avatar-v2:'
const MAX_AVATAR_SIGNING_WINDOW_SECONDS = 60
const DEFAULT_QUERY_STALE_TIME_MS = 5 * 60 * 1000
const AVATAR_REFRESH_MARGIN_MS = 5 * 1000

type AvatarUrl = string | null | undefined

type QueryWithData<T> = {
  state: {
    data: T | undefined
    dataUpdatedAt: number
  }
}

export const getAvatarSignatureTimes = (url: AvatarUrl) => {
  if (!url) return undefined

  try {
    const parsedUrl = new URL(url, 'https://dify.invalid')
    if (!parsedUrl.pathname.endsWith('/file-preview')) return undefined

    const query = parsedUrl.searchParams
    if (!query.get('nonce')?.startsWith(ACCOUNT_AVATAR_NONCE_PREFIX)) return undefined

    const timestamp = Number(query.get('timestamp'))
    const expiresAt = Number(query.get('expires_at'))
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp <= 0 ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= timestamp
    )
      return undefined

    const lifetime = expiresAt - timestamp
    // Match the server's signing window, which also shortens for small configured lifetimes.
    const signingWindow = Math.min(
      MAX_AVATAR_SIGNING_WINDOW_SECONDS,
      Math.max(1, Math.floor(lifetime / 2)),
    )
    return { timestamp, expiresAt, signingWindow }
  } catch {
    return undefined
  }
}

const getAvatarFreshness = (urls: Iterable<AvatarUrl>): number | undefined => {
  let freshness: number | undefined
  for (const url of urls) {
    const signature = getAvatarSignatureTimes(url)
    if (signature) {
      const { timestamp, expiresAt, signingWindow } = signature
      const ms = Math.max(
        0,
        (expiresAt - timestamp - signingWindow) * 1000 - AVATAR_REFRESH_MARGIN_MS,
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
