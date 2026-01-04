import * as React from 'react'
import { vi } from 'vitest'

type TranslationMap = Record<string, string | string[]>

/**
 * Create a t function with optional custom translations
 * Checks translations[key] first, then translations[ns.key], then returns ns.key as fallback
 */
export function createTFunction(translations: TranslationMap, defaultNs?: string) {
  return (key: string, options?: Record<string, unknown>) => {
    // Check custom translations first (without namespace)
    if (translations[key] !== undefined)
      return translations[key]

    const ns = (options?.ns as string | undefined) ?? defaultNs
    const fullKey = ns ? `${ns}.${key}` : key

    // Check custom translations with namespace
    if (translations[fullKey] !== undefined)
      return translations[fullKey]

    // Serialize params (excluding ns) for test assertions
    const params = { ...options }
    delete params.ns
    const suffix = Object.keys(params).length > 0 ? `:${JSON.stringify(params)}` : ''
    return `${fullKey}${suffix}`
  }
}

/**
 * Create useTranslation mock with optional custom translations
 *
 * @example
 * vi.mock('react-i18next', () => createUseTranslationMock({
 *   'operation.confirm': 'Confirm',
 * }))
 */
export function createUseTranslationMock(translations: TranslationMap = {}) {
  return {
    useTranslation: (defaultNs?: string) => ({
      t: createTFunction(translations, defaultNs),
      i18n: {
        language: 'en',
        changeLanguage: vi.fn(),
      },
    }),
  }
}

/**
 * Create Trans component mock with optional custom translations
 */
export function createTransMock(translations: TranslationMap = {}) {
  return {
    Trans: ({ i18nKey, children }: {
      i18nKey: string
      children?: React.ReactNode
    }) => {
      const text = translations[i18nKey] ?? i18nKey
      return React.createElement('span', { 'data-i18n-key': i18nKey }, children ?? text)
    },
  }
}

/**
 * Create complete react-i18next mock (useTranslation + Trans)
 *
 * @example
 * vi.mock('react-i18next', () => createReactI18nextMock({
 *   'modal.title': 'My Modal',
 * }))
 */
export function createReactI18nextMock(translations: TranslationMap = {}) {
  return {
    ...createUseTranslationMock(translations),
    ...createTransMock(translations),
  }
}
