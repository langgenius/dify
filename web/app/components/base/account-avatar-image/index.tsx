'use client'

import type { AvatarImageProps } from '@langgenius/dify-ui/avatar'
import { AvatarImage } from '@langgenius/dify-ui/avatar'
import { useEffect, useRef, useState } from 'react'
import { API_PREFIX } from '@/config'
import {
  getSessionRefreshRevision,
  subscribeToSessionRefresh,
} from '@/service/session-refresh-events'

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

function RecoverableAccountAvatarImage({ src, onLoadingStatusChange, ...props }: AvatarImageProps) {
  const attemptedRef = useRef(false)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const [initialRefreshRevision] = useState(getSessionRefreshRevision)
  const [retry, setRetry] = useState(0)

  useEffect(
    () => () => {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
    },
    [],
  )

  const retryAfterRefresh = () => {
    if (!attemptedRef.current) {
      attemptedRef.current = true
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
      setRetry(1)
    }
  }

  const handleLoadingStatusChange = (status: LoadingStatus) => {
    onLoadingStatusChange?.(status)
    if (
      status !== 'error' ||
      typeof src !== 'string' ||
      attemptedRef.current ||
      unsubscribeRef.current ||
      !isStableAccountAvatarURL(src)
    )
      return

    if (getSessionRefreshRevision() !== initialRefreshRevision) {
      retryAfterRefresh()
      return
    }

    unsubscribeRef.current = subscribeToSessionRefresh(retryAfterRefresh)
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
