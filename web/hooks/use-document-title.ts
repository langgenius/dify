'use client'
import { useLayoutEffect } from 'react'
import { useGlobalPublicStore } from '@/context/global-public-context'

export default function useDocumentTitle(title: string) {
  const { systemFeatures } = useGlobalPublicStore()
  useLayoutEffect(() => {
    const prefix = title ? `${title} - ` : ''
    if (systemFeatures.branding.enabled) {
      document.title = `${prefix}${systemFeatures.branding.application_title}`
      const faviconEle = document.querySelector('link[rel*=\'icon\']') as HTMLLinkElement
      faviconEle.href = systemFeatures.branding.favicon
    }
    else {
      document.title = `${prefix}Dify`
    }
  }, [systemFeatures, title])
}
