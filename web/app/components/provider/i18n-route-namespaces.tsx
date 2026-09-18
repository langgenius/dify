'use client'

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getInitialNamespacesForPath } from '@/i18n-config/initial-namespaces'
import { usePathname } from '@/next/navigation'

export function I18nRouteNamespacesSync() {
  const pathname = usePathname()
  const { i18n } = useTranslation()

  useEffect(() => {
    const required = getInitialNamespacesForPath(pathname)
    const missing = required.filter(namespace => !i18n.hasLoadedNamespace(namespace))
    if (missing.length > 0) void i18n.loadNamespaces(missing)
  }, [i18n, pathname])

  return null
}
