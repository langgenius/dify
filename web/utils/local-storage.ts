import { useSyncExternalStore } from 'react'
import { isClient } from './client'

const LOCAL_STORAGE_CHANGE_EVENT = 'dify-local-storage-change'

type LocalStorageChangeDetail = {
  key: string
}

export const getLocalStorageItem = (key: string, fallback: string | null = null) => {
  if (!isClient)
    return fallback

  try {
    return window.localStorage.getItem(key) ?? fallback
  }
  catch {
    return fallback
  }
}

export const setLocalStorageItem = (key: string, value: string) => {
  if (!isClient)
    return

  try {
    window.localStorage.setItem(key, value)
    window.dispatchEvent(new CustomEvent<LocalStorageChangeDetail>(LOCAL_STORAGE_CHANGE_EVENT, {
      detail: { key },
    }))
  }
  catch {

  }
}

/* @public */
export const removeLocalStorageItem = (key: string) => {
  if (!isClient)
    return

  try {
    window.localStorage.removeItem(key)
    window.dispatchEvent(new CustomEvent<LocalStorageChangeDetail>(LOCAL_STORAGE_CHANGE_EVENT, {
      detail: { key },
    }))
  }
  catch {

  }
}

export const getLocalStorageBoolean = (key: string, fallback = false) => {
  const value = getLocalStorageItem(key)
  if (value === null)
    return fallback

  return value === 'true'
}

export const getLocalStorageNumber = (key: string, fallback: number) => {
  const value = getLocalStorageItem(key)
  if (!value)
    return fallback

  const parsed = Number.parseFloat(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

const subscribeLocalStorage = (key: string, onStoreChange: () => void) => {
  if (!isClient)
    return () => {}

  const handleChange = (event: Event) => {
    if (event instanceof StorageEvent && event.key !== key)
      return
    if (event instanceof CustomEvent && event.detail?.key !== key)
      return

    onStoreChange()
  }

  window.addEventListener('storage', handleChange)
  window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleChange)

  return () => {
    window.removeEventListener('storage', handleChange)
    window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleChange)
  }
}

export const useLocalStorageItem = (key: string, fallback: string | null = null) => {
  return useSyncExternalStore(
    onStoreChange => subscribeLocalStorage(key, onStoreChange),
    () => getLocalStorageItem(key, fallback),
    () => fallback,
  )
}

export const useLocalStorageBoolean = (key: string, fallback = false) => {
  const value = useLocalStorageItem(key)
  if (value === null)
    return fallback

  return value === 'true'
}
