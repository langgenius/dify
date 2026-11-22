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
 * Base UI marks it loaded before it paints. When that URL stops loading (its signature expired
 * and the browser let the picture go), the URL received since takes its place for all of them.
 */
export function useAvatarSrc(url: string | null | undefined) {
  const queryClient = useQueryClient()
  const received = url || undefined
  const file = received?.split('?')[0]
  const { data: shared } = useQuery(avatarSrcOptions(file, received))
  // A shared URL this avatar failed to load, so it shows the one it received instead.
  const [failed, setFailed] = useState<string>()
  const src = shared && shared !== failed ? shared : received

  const onLoadingStatusChange = (status: LoadingStatus) => {
    if (!src) return
    if (status === 'error') {
      setFailed(src)
      if (src !== received) queryClient.setQueryData(avatarSrcKey(file), received)
    } else if (status === 'loaded' && src !== shared) {
      queryClient.setQueryData(avatarSrcKey(file), src)
    }
  }

  return { src, onLoadingStatusChange }
}
