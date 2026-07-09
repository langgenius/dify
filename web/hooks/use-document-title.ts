'use client'
import { useQuery } from '@tanstack/react-query'
import { useFavicon, useTitle } from 'ahooks'
import { useEffect } from 'react'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { defaultSystemFeatures } from '@/features/system-features/config'
import { basePath } from '@/utils/var'

export default function useDocumentTitle(title: string) {
  const { data, isPending } = useQuery(systemFeaturesQueryOptions())
  const systemFeatures = data ?? defaultSystemFeatures
  const branding = systemFeatures.branding ?? defaultSystemFeatures.branding
  const prefix = title ? `${title} - ` : ''
  let titleStr = ''
  let favicon = ''
  if (isPending === false) {
    if (branding.enabled) {
      titleStr = `${prefix}${branding.application_title}`
      favicon = branding.favicon
    } else {
      titleStr = `${prefix}Dify`
      favicon = `${basePath}/favicon.ico`
    }
  }
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
