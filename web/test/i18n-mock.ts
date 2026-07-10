import type { Namespace, SelectorParam } from 'i18next'
import { keyFromSelector } from 'i18next'
import * as React from 'react'
import { vi } from 'vitest'

type TranslationMap = Record<string, string | string[]>
type TranslationKey<Ns extends Namespace = Namespace> = string | SelectorParam<Ns>
type TranslationNamespace = Namespace
type SelectorI18nKeyProps<Props, Ns extends Namespace> = Omit<Props, 'i18nKey' | 'ns'>
  & (Props extends { i18nKey: unknown }
    ? { i18nKey: TranslationKey<Ns> }
    : { i18nKey?: TranslationKey<Ns> })
  & (Props extends { ns: unknown } ? { ns: Ns } : { ns?: Ns })

function splitNamespacedKey(key: string) {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex < 1)
    return { key }

  return {
    key: key.slice(separatorIndex + 1),
    namespace: key.slice(0, separatorIndex),
  }
}

function resolveI18nKey<Ns extends Namespace>(key: TranslationKey<Ns>, namespace?: Ns) {
  if (typeof key === 'string')
    return key

  return keyFromSelector(
    key as Parameters<typeof keyFromSelector>[0],
    namespace ? { ns: namespace } : undefined,
  )
}

function resolveTranslationKey<Ns extends Namespace>(key: TranslationKey<Ns>, namespace?: Ns) {
  return splitNamespacedKey(resolveI18nKey(key, namespace))
}

function getPrimaryNamespace(namespace?: TranslationNamespace) {
  return typeof namespace === 'string' ? namespace : namespace?.[0]
}

export function withSelectorKey<Ns extends Namespace, Args extends unknown[], Result>(
  translate: (key: string, ...args: Args) => Result,
  namespace: Ns,
): (key: TranslationKey<Ns>, ...args: Args) => Result
export function withSelectorKey<Args extends unknown[], Result>(
  translate: (key: string, ...args: Args) => Result,
  namespace?: undefined,
): <Ns extends Namespace>(key: TranslationKey<Ns>, ...args: Args) => Result
export function withSelectorKey<Args extends unknown[], Result>(
  translate: (key: string, ...args: Args) => Result,
  namespace?: TranslationNamespace,
) {
  return <Ns extends Namespace>(key: TranslationKey<Ns>, ...args: Args) => translate(resolveI18nKey(key, namespace as Ns), ...args)
}

export function withSelectorKeyProps<
  Props extends object,
  Result,
>(render: (props: Props) => Result) {
  return <Ns extends Namespace>(props: SelectorI18nKeyProps<Props, Ns>) => {
    const i18nKey = props.i18nKey
    const resolvedProps = {
      ...props,
      ...(i18nKey === undefined ? {} : { i18nKey: resolveI18nKey(i18nKey, props.ns) }),
    } as unknown as Props
    return render(resolvedProps)
  }
}

/**
 * Create a t function with optional custom translations
 * Checks translations[key] first, then translations[ns.key], then returns ns.key as fallback
 */
function createTFunction<Ns extends Namespace>(translations: TranslationMap, defaultNs?: Ns) {
  return (translationKey: TranslationKey<Ns>, options?: Record<string, unknown>) => {
    const optionNs = options?.ns as TranslationNamespace | undefined
    const namespace = (optionNs ?? defaultNs) as Ns | undefined
    const { key, namespace: keyNamespace } = resolveTranslationKey(translationKey, namespace)

    // Check custom translations first (without namespace)
    if (translations[key] !== undefined)
      return translations[key]

    const ns = keyNamespace ?? getPrimaryNamespace(optionNs ?? defaultNs)
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
 * Caches t functions by defaultNs so the same reference is returned
 * across renders, preventing infinite re-render loops when components
 * include t in useEffect/useMemo dependency arrays.
 *
 * @example
 * vi.mock('react-i18next', () => createUseTranslationMock({
 *   'operation.confirm': 'Confirm',
 * }))
 */
function createUseTranslationMock(translations: TranslationMap = {}) {
  const tCache = new Map<string, unknown>()
  const i18n = {
    language: 'en',
    changeLanguage: vi.fn(),
  }
  return {
    useTranslation: <Ns extends Namespace = 'app'>(defaultNs?: Ns) => {
      const cacheKey = typeof defaultNs === 'string' ? defaultNs : defaultNs?.join(',') ?? ''
      if (!tCache.has(cacheKey))
        tCache.set(cacheKey, createTFunction(translations, defaultNs))
      return {
        t: tCache.get(cacheKey)! as ReturnType<typeof createTFunction<Ns>>,
        i18n,
      }
    },
  }
}

/**
 * Create Trans component mock with optional custom translations
 */
function createTransMock(translations: TranslationMap = {}) {
  return {
    Trans: <Ns extends Namespace>({ i18nKey, ns, children }: {
      i18nKey: TranslationKey<Ns>
      ns?: Ns
      children?: React.ReactNode
    }) => {
      const isSelector = typeof i18nKey === 'function'
      const { key, namespace: keyNamespace } = resolveTranslationKey(i18nKey, ns)
      const namespace = keyNamespace ?? (isSelector ? getPrimaryNamespace(ns) : undefined)
      const fullKey = namespace ? `${namespace}.${key}` : key
      const text = translations[key] ?? translations[fullKey] ?? fullKey
      return React.createElement('span', { 'data-i18n-key': fullKey }, children ?? text)
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
