'use client'

import { useEffect, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getInitialNamespacesForPath } from '@/i18n-config/initial-namespaces'
import { usePathname } from '@/next/navigation'

const isPathUnder = (pathname: string, route: string) =>
  pathname === route || pathname.startsWith(`${route}/`)

const PREFETCH_PATHS_BY_ROUTE: { match: (pathname: string) => boolean; prefetchPath: string }[] = [
  {
    match: (pathname) => isPathUnder(pathname, '/apps'),
    prefetchPath: '/app/prefetch',
  },
  {
    match: (pathname) => isPathUnder(pathname, '/signin') || isPathUnder(pathname, '/signup'),
    prefetchPath: '/explore/apps',
  },
]

function getMissingNamespaces(
  i18n: { hasLoadedNamespace: (namespace: string) => boolean },
  pathname: string,
) {
  const required = getInitialNamespacesForPath(pathname)
  return required.filter((namespace) => !i18n.hasLoadedNamespace(namespace))
}

async function ensureNamespaces(
  i18n: {
    hasLoadedNamespace: (namespace: string) => boolean
    loadNamespaces: (namespaces: string[]) => Promise<unknown>
  },
  pathname: string,
) {
  const missing = getMissingNamespaces(i18n, pathname)
  if (missing.length > 0) await i18n.loadNamespaces(missing)
}

export function I18nRouteNamespacesSync() {
  const pathname = usePathname()
  const { i18n } = useTranslation()

  useLayoutEffect(() => {
    void ensureNamespaces(i18n, pathname)
  }, [i18n, pathname])

  useEffect(() => {
    for (const rule of PREFETCH_PATHS_BY_ROUTE) {
      if (!rule.match(pathname)) continue
      void ensureNamespaces(i18n, rule.prefetchPath)
    }
  }, [i18n, pathname])

  return null
}
