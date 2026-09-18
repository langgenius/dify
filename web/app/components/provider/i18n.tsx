'use client'

import type { i18n as I18nInstance, Resource } from 'i18next'
import type { Locale } from '@/i18n-config'
import { useEffect, useRef } from 'react'
import { I18nextProvider } from 'react-i18next'
import { createI18nextInstance } from '@/i18n-config/client'

function applyResource(instance: I18nInstance, resource: Resource) {
  for (const [lng, namespaces] of Object.entries(resource)) {
    if (!namespaces || typeof namespaces !== 'object') continue
    for (const [ns, bundle] of Object.entries(namespaces)) {
      instance.addResourceBundle(lng, ns, bundle, true, true)
    }
  }
}

export function I18nClientProvider({
  locale,
  resource,
  children,
}: {
  locale: Locale
  resource: Resource
  children: React.ReactNode
}) {
  const i18nRef = useRef<I18nInstance | null>(null)
  if (i18nRef.current === null) i18nRef.current = createI18nextInstance(locale, resource)

  const i18n = i18nRef.current

  const localeRef = useRef(locale)
  useEffect(() => {
    if (localeRef.current === locale) return
    localeRef.current = locale
    void i18n.changeLanguage(locale)
  }, [locale, i18n])

  const resourceRef = useRef(resource)
  useEffect(() => {
    if (resourceRef.current === resource) return
    resourceRef.current = resource
    applyResource(i18n, resource)
  }, [resource, i18n])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
