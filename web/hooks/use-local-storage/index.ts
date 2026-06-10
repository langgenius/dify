import { useCallback, useEffect, useLayoutEffect as useLayoutEffectFromReact, useMemo, useSyncExternalStore } from 'react'
import { noop } from '../noop'
import 'client-only'

type NotUndefined<T> = T extends undefined ? never : T
type StateHookTuple<T> = readonly [T, React.Dispatch<React.SetStateAction<T | null>>]

type Serializer<T> = (value: T) => string
type Deserializer<T> = (value: string) => T

export type UseLocalStorageRawOption = {
  raw: true
}

export type UseLocalStorageParserOption<T> = {
  raw?: false
  serializer: Serializer<T>
  deserializer: Deserializer<T>
}

const FOXACT_LOCAL_STORAGE_EVENT_KEY = 'foxact-use-local-storage'
const HOOK_NAME = 'foxact/use-local-storage'

const useLayoutEffect = typeof window === 'undefined'
  ? useEffect
  : useLayoutEffectFromReact

type ErrorConstructorWithStackTraceLimit = ErrorConstructor & {
  stackTraceLimit?: number
}

const errorConstructor = Error as ErrorConstructorWithStackTraceLimit
const stackTraceLimitProperty = Object.getOwnPropertyDescriptor(errorConstructor, 'stackTraceLimit')
const hasWritableStackTraceLimit = stackTraceLimitProperty?.writable && typeof stackTraceLimitProperty.value === 'number'

function createStacklessError<T = Error>(errorFactory: () => T): T {
  const originalStackTraceLimit = errorConstructor.stackTraceLimit

  if (hasWritableStackTraceLimit)
    errorConstructor.stackTraceLimit = 0

  const error = errorFactory()

  if (hasWritableStackTraceLimit)
    errorConstructor.stackTraceLimit = originalStackTraceLimit

  return error
}

function noSSRError(errorMessage?: string, nextjsDigest = 'BAILOUT_TO_CLIENT_SIDE_RENDERING') {
  const error = createStacklessError(() => new Error(errorMessage)) as Error & {
    digest?: string
    recoverableError?: string
  }

  error.digest = nextjsDigest
  error.recoverableError = 'NO_SSR'

  return error
}

function getServerSnapshotWithoutServerValue(): never {
  throw noSSRError(`[${HOOK_NAME}] cannot be used on the server without a serverValue`)
}

function rawSerializer<T>(value: T): string {
  return value as string
}

function rawDeserializer<T>(value: string): T {
  return value as T
}

function isStorageSetter<T>(
  value: React.SetStateAction<T | null>,
): value is (previousState: T | null) => T | null {
  return typeof value === 'function'
}

const dispatchStorageEvent = typeof window === 'undefined'
  ? noop
  : (key: string) => {
      window.dispatchEvent(new CustomEvent<string>(FOXACT_LOCAL_STORAGE_EVENT_KEY, { detail: key }))
    }

const setStorageItem = typeof window === 'undefined'
  ? noop
  : (key: string, value: string) => {
      try {
        window.localStorage.setItem(key, value)
      }
      catch {
        console.warn(`[${HOOK_NAME}] Failed to set value to localStorage, it might be blocked`)
      }
      finally {
        dispatchStorageEvent(key)
      }
    }

const removeStorageItem = typeof window === 'undefined'
  ? noop
  : (key: string) => {
      try {
        window.localStorage.removeItem(key)
      }
      catch {
        console.warn(`[${HOOK_NAME}] Failed to remove value from localStorage, it might be blocked`)
      }
      finally {
        dispatchStorageEvent(key)
      }
    }

function getStorageItem(key: string) {
  if (typeof window === 'undefined')
    return null

  try {
    return window.localStorage.getItem(key)
  }
  catch {
    console.warn(`[${HOOK_NAME}] Failed to get value from localStorage, it might be blocked`)
    return null
  }
}

function getStorageOptions<T>(
  options: UseLocalStorageRawOption | UseLocalStorageParserOption<T>,
) {
  return options.raw
    ? {
        serializer: rawSerializer<T>,
        deserializer: rawDeserializer<T>,
      }
    : {
        serializer: options.serializer,
        deserializer: options.deserializer,
      }
}

const defaultStorageOptions = {
  raw: false,
  serializer: JSON.stringify,
  deserializer: JSON.parse,
} satisfies UseLocalStorageParserOption<unknown>

/** @see https://foxact.skk.moe/use-local-storage */
export const useSetLocalStorage = <T>(
  key: string,
  options: UseLocalStorageRawOption | UseLocalStorageParserOption<T> = defaultStorageOptions as UseLocalStorageParserOption<T>,
) => {
  const { serializer, deserializer } = getStorageOptions(options)

  return useCallback((value: React.SetStateAction<T | null>) => {
    try {
      let nextState: T | null
      if (isStorageSetter(value)) {
        const currentRaw = getStorageItem(key)
        const currentState = currentRaw === null ? null : deserializer(currentRaw)
        nextState = value(currentState)
      }
      else {
        nextState = value
      }

      if (nextState === null)
        removeStorageItem(key)
      else
        setStorageItem(key, serializer(nextState))
    }
    catch (error) {
      console.warn(error)
    }
  }, [key, serializer, deserializer])
}

function useLocalStorageValue<T>(
  key: string,
  serverValue: NotUndefined<T>,
  options?: UseLocalStorageRawOption | UseLocalStorageParserOption<T>,
): T
function useLocalStorageValue<T>(
  key: string,
  serverValue?: undefined,
  options?: UseLocalStorageRawOption | UseLocalStorageParserOption<T>,
): T | null
function useLocalStorageValue<T>(
  key: string,
  serverValue?: NotUndefined<T>,
  options: UseLocalStorageRawOption | UseLocalStorageParserOption<T> = defaultStorageOptions as UseLocalStorageParserOption<T>,
): T | null {
  const subscribeToSpecificKeyOfLocalStorage = useCallback((callback: () => void) => {
    if (typeof window === 'undefined')
      return noop

    const handleStorageEvent = (event: StorageEvent) => {
      if (!('key' in event) || event.key === key)
        callback()
    }
    const handleCustomStorageEvent: EventListener = (event) => {
      if (event instanceof CustomEvent && event.detail === key)
        callback()
    }

    window.addEventListener('storage', handleStorageEvent)
    window.addEventListener(FOXACT_LOCAL_STORAGE_EVENT_KEY, handleCustomStorageEvent)

    return () => {
      window.removeEventListener('storage', handleStorageEvent)
      window.removeEventListener(FOXACT_LOCAL_STORAGE_EVENT_KEY, handleCustomStorageEvent)
    }
  }, [key])

  const { serializer, deserializer } = getStorageOptions(options)
  const getClientSnapshot = () => getStorageItem(key)
  const getServerSnapshot = serverValue === undefined
    ? getServerSnapshotWithoutServerValue
    : () => serializer(serverValue)

  const store = useSyncExternalStore(
    subscribeToSpecificKeyOfLocalStorage,
    getClientSnapshot,
    getServerSnapshot,
  )

  const deserialized = useMemo(() => (store === null ? null : deserializer(store)), [store, deserializer])

  useLayoutEffect(() => {
    if (getStorageItem(key) === null && serverValue !== undefined)
      setStorageItem(key, serializer(serverValue))
  }, [key, serializer, serverValue])

  return deserialized === null
    ? (serverValue === undefined ? null : serverValue)
    : deserialized
}

function useLocalStorage<T>(
  key: string,
  serverValue: NotUndefined<T>,
  options?: UseLocalStorageRawOption | UseLocalStorageParserOption<T>,
): StateHookTuple<T>
function useLocalStorage<T>(
  key: string,
  serverValue?: undefined,
  options?: UseLocalStorageRawOption | UseLocalStorageParserOption<T>,
): StateHookTuple<T | null>
/** @see https://foxact.skk.moe/use-local-storage */
function useLocalStorage<T>(
  key: string,
  serverValue?: NotUndefined<T>,
  options: UseLocalStorageRawOption | UseLocalStorageParserOption<T> = defaultStorageOptions as UseLocalStorageParserOption<T>,
): StateHookTuple<T> | StateHookTuple<T | null> {
  const value = useLocalStorageValue<T>(key, serverValue!, options)
  const setState = useSetLocalStorage<T>(key, options)

  return [value, setState] as const
}

export { useLocalStorage }
