'use client'
import { useLayoutEffect } from 'react'
import { useGlobalPublicStore } from '@/context/global-public-context'

export default function useDocumentTitle(title: string) {
  const { systemFeatures } = useGlobalPublicStore()
  useLayoutEffect(() => {
    if (systemFeatures.branding.enabled)
      document.title = `${title} - ${systemFeatures.branding.application_title}`
    else
      document.title = `${title} - Dify`
  }, [systemFeatures, title])
}
