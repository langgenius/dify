'use client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useFavicon, useTitle } from 'ahooks'
import { useEffect } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { basePath } from '@/utils/var'

export default function useDocumentTitle(title: string) {
  const { data } = useSuspenseQuery(systemFeaturesQueryOptions())
  const branding = data.branding
  const prefix = title ? `${title} - ` : ''
  const titleStr = branding.enabled ? `${prefix}${branding.application_title}` : `${prefix}Dify`
  const favicon = branding.enabled ? branding.favicon : `${basePath}/favicon.ico`
  useTitle(titleStr)
  useEffect(() => {
    let apple: HTMLLinkElement | null = null
    if (branding.favicon) {
      document
        .querySelectorAll(
          "link[rel='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon'], link[rel='mask-icon']",
        )
        .forEach((n) => n.parentNode?.removeChild(n))

      apple = document.createElement('link')
      apple.rel = 'apple-touch-icon'
      apple.href = branding.favicon
      document.head.appendChild(apple)
    }

    return () => {
      apple?.remove()
    }
  }, [branding.favicon])
  useFavicon(favicon)
}
