'use client'
import { useQuery } from '@tanstack/react-query'
import { useTitle } from 'ahooks'
import { useEffect } from 'react'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { defaultSystemFeatures } from '@/types/feature'
import { setRuntimeFavicon } from '@/utils/favicon'
import { basePath } from '@/utils/var'

export default function useDocumentTitle(title: string) {
  const { data, isPending } = useQuery(systemFeaturesQueryOptions())
  const systemFeatures = data ?? defaultSystemFeatures
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
    setRuntimeFavicon('document', favicon, {
      appleTouchIconHref: systemFeatures.branding.enabled
        ? systemFeatures.branding.favicon
        : '',
    })
  }, [favicon, systemFeatures.branding.enabled, systemFeatures.branding.favicon])
}
