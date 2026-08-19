'use client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useFavicon } from 'ahooks'
import { useEffect } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { formatDocumentTitle, getApplicationTitle } from '@/utils/document-title'
import { basePath } from '@/utils/var'

export default function useDocumentTitle(title: string | null) {
  const { data } = useSuspenseQuery(systemFeaturesQueryOptions())
  const branding = data.branding
  const titleStr = title === null ? null : formatDocumentTitle(title, getApplicationTitle(branding))
  const favicon = branding.enabled ? branding.favicon : `${basePath}/favicon.ico`
  useEffect(() => {
    if (titleStr !== null) document.title = titleStr
  }, [titleStr])
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
