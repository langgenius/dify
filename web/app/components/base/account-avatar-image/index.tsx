'use client'

import type { AvatarImageProps } from '@langgenius/dify-ui/avatar'
import { AvatarImage } from '@langgenius/dify-ui/avatar'
import { useRef, useState } from 'react'
import { API_PREFIX } from '@/config'
import { refreshAccessTokenOrReLogin } from '@/service/refresh-token'

const SESSION_REFRESH_TIMEOUT = 100_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type LoadingStatus = Parameters<NonNullable<AvatarImageProps['onLoadingStatusChange']>>[0]

const isStableAccountAvatarURL = (src: string) => {
  try {
    const consoleAPI = new URL(API_PREFIX, globalThis.location.origin)
    const avatar = new URL(src, globalThis.location.origin)
    if (avatar.origin !== consoleAPI.origin || avatar.search || avatar.hash) return false

    const apiPath = consoleAPI.pathname.replace(/\/+$/, '')
    const prefix = `${apiPath}/accounts/`
    if (!avatar.pathname.startsWith(prefix)) return false

    const suffix = avatar.pathname.slice(prefix.length).split('/')
    if (suffix.length !== 3) return false
    const accountId = suffix[0] ?? ''
    const fileId = suffix[2] ?? ''
    return suffix[1] === 'avatars' && UUID.test(accountId) && UUID.test(fileId)
  } catch {
    return false
  }
}

const recoverExpiredAccountAvatarSession = async (src: string) => {
  try {
    // oxlint-disable-next-line no-restricted-properties -- Native image requests bypass Console transport; this probe distinguishes an expired session from a permanent image failure.
    const response = await globalThis.fetch(src, {
      method: 'HEAD',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(SESSION_REFRESH_TIMEOUT),
    })
    if (response.ok) return true
    if (response.status !== 401) return false

    await refreshAccessTokenOrReLogin(SESSION_REFRESH_TIMEOUT)
    return true
  } catch {
    return false
  }
}

function RecoverableAccountAvatarImage({ src, onLoadingStatusChange, ...props }: AvatarImageProps) {
  const attemptedRef = useRef(false)
  const [retry, setRetry] = useState(0)

  const handleLoadingStatusChange = (status: LoadingStatus) => {
    onLoadingStatusChange?.(status)
    if (
      status !== 'error' ||
      typeof src !== 'string' ||
      attemptedRef.current ||
      !isStableAccountAvatarURL(src)
    )
      return

    attemptedRef.current = true
    void recoverExpiredAccountAvatarSession(src).then((recovered) => {
      if (recovered) setRetry(1)
    })
  }

  return (
    <AvatarImage
      key={retry}
      src={src}
      onLoadingStatusChange={handleLoadingStatusChange}
      {...props}
    />
  )
}

export function AccountAvatarImage(props: AvatarImageProps) {
  const sourceKey = typeof props.src === 'string' ? props.src : undefined
  return <RecoverableAccountAvatarImage key={sourceKey} {...props} />
}
