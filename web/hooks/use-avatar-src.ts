import type { AvatarImageProps } from '@langgenius/dify-ui/avatar'
import { queryOptions, skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

type LoadingStatus = Parameters<NonNullable<AvatarImageProps['onLoadingStatusChange']>>[0]

const avatarSrcKey = (file: string | undefined) => ['avatar-src', file] as const
// Nothing is fetched: a file's URL is the first one received, or the one set after it failed.
const avatarSrcOptions = (file: string | undefined, received: string | undefined) =>
  queryOptions<string>({
    queryKey: avatarSrcKey(file),
    queryFn: skipToken,
    initialData: received,
    staleTime: Infinity,
  })

/**
 * The `src` for an avatar image. Avatar URLs are signed per response, so the same picture comes
 * back under a new URL from every request, and a new URL makes the browser download it again
 * while the fallback shows. The query cache keeps one URL per avatar file, the first one
 * received, and every avatar of that file shows it: the browser already holds that picture, so
 * Base UI marks it loaded before it paints. An avatar that cannot load the shared URL (its
 * signature expired and the browser let the picture go) shows the URL it received instead, and
 * a URL that loads becomes the shared one. Only a URL that loaded is ever shared, so avatars
 * never pass failing URLs back and forth.
 */
export function useAvatarSrc(url: string | null | undefined) {
  const queryClient = useQueryClient()
  const received = url || undefined
  const file = received?.split('?')[0]
  const { data: shared } = useQuery(avatarSrcOptions(file, received))
  // URLs this avatar failed to load; it shows the first of the shared and received ones left.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const src = [shared, received].find((candidate) => candidate && !failed.has(candidate))

  const onLoadingStatusChange = (status: LoadingStatus) => {
    if (!src) return
    if (status === 'error') setFailed((urls) => new Set(urls).add(src))
    else if (status === 'loaded' && src !== shared)
      queryClient.setQueryData(avatarSrcKey(file), src)
  }

  return { src, onLoadingStatusChange }
}
