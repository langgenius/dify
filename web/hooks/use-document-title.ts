'use client'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useFavicon, useTitle } from 'ahooks'

export default function useDocumentTitle(title: string) {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const prefix = title ? `${title} - ` : ''
  useTitle(systemFeatures.branding.enabled ? `${prefix}${systemFeatures.branding.application_title}` : `${prefix}Dify`)
  useFavicon(systemFeatures.branding.enabled ? systemFeatures.branding.favicon : '/favicon.ico')
}
