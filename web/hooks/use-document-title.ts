'use client'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useFavicon, useTitle } from 'ahooks'
import { basePath } from '@/utils/var'
import { useEffect } from 'react'

export default function useDocumentTitle(title: string) {
  const isPending = useGlobalPublicStore(s => s.isGlobalPending)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const prefix = title ? `${title} - ` : ''
  let titleStr = ''
  let favicon = ''
  if (isPending === false) {
    if (systemFeatures.branding.enabled) {
      titleStr = `${prefix}${systemFeatures.branding.application_title}`
      favicon = systemFeatures.branding.favicon
    }
    else {
      titleStr = `${prefix}Dify`
      favicon = `${basePath}/favicon.ico`
    }
  }
  useTitle(titleStr)
  useEffect(() => {
    let apple: HTMLLinkElement | null = null
    if (systemFeatures.branding.favicon) {
      document
        .querySelectorAll(
          'link[rel=\'icon\'], link[rel=\'shortcut icon\'], link[rel=\'apple-touch-icon\'], link[rel=\'mask-icon\']',
        )
        .forEach(n => n.parentNode?.removeChild(n))

      apple = document.createElement('link')
      apple.rel = 'apple-touch-icon'
      apple.href = systemFeatures.branding.favicon
      document.head.appendChild(apple)
    }

    return () => {
      apple?.remove()
    }
  }, [systemFeatures.branding.favicon])
  useFavicon(favicon)
}
