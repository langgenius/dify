const avatarInitialSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const ACCOUNT_AVATAR_NONCE_PREFIX = 'account-avatar-v2:'
const DEFAULT_QUERY_STALE_TIME_MS = 5 * 60 * 1000
const AVATAR_REFRESH_MARGIN_MS = 5 * 1000

type AvatarUrl = string | null | undefined

type QueryWithData<T> = {
  state: {
    data: T | undefined
    dataUpdatedAt: number
  }
}

export const getAvatarExpiresAt = (url: AvatarUrl): number | undefined => {
  if (!url) return undefined

  try {
    const parsedUrl = new URL(url, 'https://dify.invalid')
    if (!parsedUrl.pathname.endsWith('/file-preview')) return undefined

    const query = parsedUrl.searchParams
    if (!query.get('nonce')?.startsWith(ACCOUNT_AVATAR_NONCE_PREFIX)) return undefined

    const expiresAt = Number(query.get('expires_at'))
    return Number.isSafeInteger(expiresAt) && expiresAt > 0 ? expiresAt * 1000 : undefined
  } catch {
    return undefined
  }
}

const getSoonestAvatarExpiry = (urls: Iterable<AvatarUrl>): number | undefined => {
  let soonest: number | undefined
  for (const url of urls) {
    const expiresAt = getAvatarExpiresAt(url)
    if (expiresAt !== undefined && (soonest === undefined || expiresAt < soonest))
      soonest = expiresAt
  }
  return soonest
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

    const expiresAt = getSoonestAvatarExpiry(getUrls(query.state.data))
    if (expiresAt === undefined) return DEFAULT_QUERY_STALE_TIME_MS

    return Math.max(
      0,
      Math.min(
        DEFAULT_QUERY_STALE_TIME_MS,
        expiresAt - AVATAR_REFRESH_MARGIN_MS - query.state.dataUpdatedAt,
      ),
    )
  }

export const shouldRefreshAvatarUrls = (urls: Iterable<AvatarUrl>, now = Date.now()): boolean => {
  const expiresAt = getSoonestAvatarExpiry(urls)
  return expiresAt !== undefined && expiresAt - AVATAR_REFRESH_MARGIN_MS <= now
}
