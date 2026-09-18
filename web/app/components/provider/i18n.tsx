'use client'

import type { Resource } from 'i18next'
import type { Locale } from '@/i18n'
import type { Namespace } from '@/i18n/resources'
import { Suspense, useEffect, useState } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { createI18nextInstance } from '@/i18n/client'
import { getRouteNamespaces } from '@/i18n/route-namespaces'
import { usePathname } from '@/next/navigation'
import { basePath } from '@/utils/var'

export function I18nClientProvider({
  locale,
  resource,
  children,
}: {
  locale: Locale
  resource: Resource
  children: React.ReactNode
}) {
  const requiredNamespaces = getRouteNamespaces(usePathname(), basePath)
  const [i18n] = useState(() => createI18nextInstance(locale, resource))
  return (
    <Suspense fallback={null}>
      <RouteTranslations
        key={requiredNamespaces.join(':')}
        i18n={i18n}
        requiredNamespaces={requiredNamespaces}
      >
        {children}
      </RouteTranslations>
    </Suspense>
  )
}

function RouteTranslations({
  i18n,
  children,
  requiredNamespaces,
}: {
  requiredNamespaces: readonly Namespace[]
  i18n: ReturnType<typeof createI18nextInstance>
  children: React.ReactNode
}) {
  const defaultNamespace = requiredNamespaces.includes('app') ? 'app' : 'common'
  useTranslation([...requiredNamespaces], { i18n })
  useEffect(() => {
    // i18next remembers every namespace ever requested. Keep language switching
    // scoped to the active route while retaining already fetched bundles.
    i18n.options.ns = [...requiredNamespaces]
    i18n.setDefaultNamespace(defaultNamespace)
  }, [i18n, requiredNamespaces, defaultNamespace])
  return (
    <I18nextProvider i18n={i18n} defaultNS={defaultNamespace}>
      {children}
    </I18nextProvider>
  )
}
