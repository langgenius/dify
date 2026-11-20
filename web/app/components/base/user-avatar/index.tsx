'use client'

import type { AvatarProps } from '@langgenius/dify-ui/avatar'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { useState } from 'react'
import { getAvatarInitial } from '@/utils/avatar'

type UserAvatarProps = Omit<AvatarProps, 'children'> & {
  name: string
  src?: string | null
  fallbackColor?: string
}

const filePreviewSignatureParams = ['timestamp', 'nonce', 'sign']

function getAvatarAssetKey(src: UserAvatarProps['src']) {
  if (!src) return undefined

  const urlKey = `url:${src}`
  try {
    const url = new URL(src, 'https://dify.invalid')
    if (
      !/^https?:$/.test(url.protocol) ||
      !/\/files\/[^/]+\/file-preview$/.test(url.pathname) ||
      !filePreviewSignatureParams.every((param) => url.searchParams.has(param))
    )
      return urlKey

    for (const param of filePreviewSignatureParams) url.searchParams.delete(param)
    return `signed-file:${url.href}`
  } catch {
    return urlKey
  }
}

function UserAvatarForAsset({ name, src, fallbackColor, ...avatarProps }: UserAvatarProps) {
  const [loadedSrc, setLoadedSrc] = useState<string>()
  const [failedSrc, setFailedSrc] = useState<string>()
  const showInitial = !src || failedSrc === src
  const sources = loadedSrc && loadedSrc !== src ? [loadedSrc, src] : [src]

  return (
    <Avatar {...avatarProps}>
      {!loadedSrc && (
        <AvatarFallback
          className={showInitial ? undefined : 'bg-background-section-burn'}
          style={showInitial && fallbackColor ? { backgroundColor: fallbackColor } : undefined}
        >
          {showInitial && getAvatarInitial(name)}
        </AvatarFallback>
      )}
      {sources.map(
        (source) =>
          source && (
            <AvatarImage
              key={source}
              src={source}
              alt=""
              keepMounted
              className={source === loadedSrc ? undefined : 'invisible'}
              onLoadingStatusChange={(status) => {
                if (source !== src) return
                // Promote the loaded element by key so switching does not request the image again.
                if (status === 'loaded') setLoadedSrc(source)
                if (status === 'error') setFailedSrc(source)
              }}
            />
          ),
      )}
    </Avatar>
  )
}

export function UserAvatar(props: UserAvatarProps) {
  return <UserAvatarForAsset key={getAvatarAssetKey(props.src)} {...props} />
}
