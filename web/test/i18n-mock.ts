import * as React from 'react'
import { vi } from 'vitest'

type TranslationMap = Record<string, string | string[]>
type TranslationNamespace = string | readonly string[]
type TranslationSelectorSource = {
  [key: string]: TranslationSelectorSource
}
type TranslationSelector = (source: TranslationSelectorSource) => unknown
type TranslationKey = string | TranslationSelector
type TranslationFunction<Args extends unknown[], Result> = {
  (key: TranslationSelector, ...args: Args): Result
  (key: unknown, ...args: Args): Result
}
type SelectorI18nKeyProps<Props, Ns extends TranslationNamespace> = Omit<Props, 'i18nKey' | 'ns'>
  & (Props extends { i18nKey: unknown }
    ? { i18nKey: TranslationKey }
    : { i18nKey?: TranslationKey })
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

const selectorPath = Symbol('selectorPath')

function createSelectorSource(path: readonly string[] = []): TranslationSelectorSource {
  return new Proxy({} as TranslationSelectorSource, {
    get: (_, property) => {
      if (property === selectorPath)
        return path
      if (typeof property !== 'string')
        return undefined
      return createSelectorSource([...path, property])
    },
  })
}

function getSelectorPath(selector: TranslationSelector) {
  const selected = selector(createSelectorSource())
  if ((typeof selected !== 'object' && typeof selected !== 'function') || selected === null)
    throw new TypeError('Translation selectors must return a translation key')

  const path = Reflect.get(selected, selectorPath) as readonly string[] | undefined
  if (!path?.length)
    throw new TypeError('Translation selectors must return a translation key')
  return path
}

function resolveSelectorKey(selector: TranslationSelector, namespace?: TranslationNamespace) {
  const path = getSelectorPath(selector)
  const namespaces = typeof namespace === 'string' ? [namespace] : namespace
  if (path.length > 1 && namespaces?.includes(path[0]))
    return `${path[0]}:${path.slice(1).join('.')}`
  return path.join('.')
}

function resolveI18nKey(key: TranslationKey, namespace?: TranslationNamespace) {
  if (typeof key === 'string')
    return key

  return resolveSelectorKey(key, namespace)
}

function resolveTranslationKey(key: TranslationKey, namespace?: TranslationNamespace) {
  return splitNamespacedKey(resolveI18nKey(key, namespace))
}

function getPrimaryNamespace(namespace?: TranslationNamespace) {
  return typeof namespace === 'string' ? namespace : namespace?.[0]
}

export function withSelectorKey<Ns extends TranslationNamespace, Args extends unknown[], Result>(
  translate: (key: string, ...args: Args) => Result,
  namespace: Ns,
): TranslationFunction<Args, Result>
export function withSelectorKey<Args extends unknown[], Result>(
  translate: (key: string, ...args: Args) => Result,
  namespace?: undefined,
): TranslationFunction<Args, Result>
export function withSelectorKey<Args extends unknown[], Result>(
  translate: (key: string, ...args: Args) => Result,
  namespace?: TranslationNamespace,
) {
  const t = (key: unknown, ...args: Args) => translate(resolveI18nKey(key as TranslationKey, namespace), ...args)
  return t as TranslationFunction<Args, Result>
}

export function withSelectorKeyProps<
  Props extends object,
  Result,
>(render: (props: Props) => Result) {
  return <Ns extends TranslationNamespace>(props: SelectorI18nKeyProps<Props, Ns>) => {
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
function createTFunction<Ns extends TranslationNamespace>(
  translations: TranslationMap,
  defaultNs?: Ns,
  config: { includeDefaultNamespace: boolean, includeOptionNamespace: boolean, includeInterpolationOptions: boolean } = {
    includeDefaultNamespace: true,
    includeOptionNamespace: true,
    includeInterpolationOptions: true,
  },
) {
  const t = (translationKey: unknown, options?: Record<string, unknown>) => {
    const optionNs = options?.ns as TranslationNamespace | undefined
    const namespace = ((config.includeOptionNamespace ? optionNs : undefined) ?? (config.includeDefaultNamespace ? defaultNs : undefined)) as Ns | undefined
    const { key, namespace: keyNamespace } = resolveTranslationKey(translationKey as TranslationKey, namespace)

    // Check custom translations first (without namespace)
    if (translations[key] !== undefined)
      return translations[key]

    const ns = keyNamespace ?? getPrimaryNamespace((config.includeOptionNamespace ? optionNs : undefined) ?? (config.includeDefaultNamespace ? defaultNs : undefined))
    const fullKey = ns ? `${ns}.${key}` : key

    // Check custom translations with namespace
    if (translations[fullKey] !== undefined)
      return translations[fullKey]

    // Serialize params (excluding ns) for test assertions
    const params = { ...options }
    delete params.ns
    const suffix = config.includeInterpolationOptions && Object.keys(params).length > 0 ? `:${JSON.stringify(params)}` : ''
    return `${fullKey}${suffix}`
  }
  return t as TranslationFunction<[options?: Record<string, unknown>], ReturnType<typeof t>>
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
function createUseTranslationMock(
  translations: TranslationMap = {},
) {
  const tCache = new Map<string, unknown>()
  const i18n = {
    language: 'en-US',
    changeLanguage: vi.fn(),
  }
  return {
    useTranslation: <Ns extends TranslationNamespace = 'app'>(defaultNs?: Ns) => {
      const cacheKey = typeof defaultNs === 'string' ? defaultNs : defaultNs?.join(',') ?? ''
      if (!tCache.has(cacheKey)) {
        tCache.set(cacheKey, createTFunction(translations, defaultNs))
      }
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
    Trans: <Ns extends TranslationNamespace>({ i18nKey, ns, children }: {
      i18nKey: TranslationKey
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
export function createReactI18nextMock(
  translations: TranslationMap = {},
) {
  const useTranslationMock = createUseTranslationMock(translations)
  const i18nextMock = createI18nextMock(translations)
  return {
    ...useTranslationMock,
    ...createTransMock(translations),
    getI18n: () => ({
      ...i18nextMock,
      language: 'en-US',
    }),
  }
}

export function createI18nextMock(
  translations: TranslationMap = {},
) {
  return {
    t: createTFunction(translations, undefined, {
      includeDefaultNamespace: false,
      includeOptionNamespace: false,
      includeInterpolationOptions: false,
    }),
  }
}

export function createReactI18nextLanguageMock(language: string) {
  const mock = createReactI18nextMock()
  return {
    ...mock,
    getI18n: () => ({
      ...mock.getI18n(),
      language,
    }),
  }
}
