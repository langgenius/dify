import { isClient } from './client'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const STORAGE_VERSION = 'v1'

let _isAvailable: boolean | null = null

function isLocalStorageAvailable(): boolean {
  if (_isAvailable !== null)
    return _isAvailable

  if (!isClient) {
    _isAvailable = false
    return false
  }

  try {
    const testKey = '__storage_test__'
    localStorage.setItem(testKey, 'test')
    localStorage.removeItem(testKey)
    _isAvailable = true
    return true
  }
  catch {
    _isAvailable = false
    return false
  }
}

function versionedKey(key: string): string {
  return `${STORAGE_VERSION}:${key}`
}

function get<T extends JsonValue>(key: string, defaultValue?: T): T | null {
  if (!isLocalStorageAvailable())
    return defaultValue ?? null

  try {
    const item = localStorage.getItem(versionedKey(key))
    if (item === null)
      return defaultValue ?? null

    try {
      return JSON.parse(item) as T
    }
    catch {
      return item as T
    }
  }
  catch {
    return defaultValue ?? null
  }
}

function set<T extends JsonValue>(key: string, value: T): void {
  if (!isLocalStorageAvailable())
    return

  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
    localStorage.setItem(versionedKey(key), stringValue)
  }
  catch {
    // Silent fail - localStorage may be full or disabled
  }
}

function remove(key: string): void {
  if (!isLocalStorageAvailable())
    return

  try {
    localStorage.removeItem(versionedKey(key))
  }
  catch {
    // Silent fail
  }
}

function getNumber(key: string): number | null
function getNumber(key: string, defaultValue: number): number
function getNumber(key: string, defaultValue?: number): number | null {
  const value = get<string | number>(key)
  if (value === null)
    return defaultValue ?? null

  const parsed = typeof value === 'number' ? value : Number.parseFloat(value as string)
  return Number.isNaN(parsed) ? (defaultValue ?? null) : parsed
}

function getBoolean(key: string): boolean | null
function getBoolean(key: string, defaultValue: boolean): boolean
function getBoolean(key: string, defaultValue?: boolean): boolean | null {
  const value = get<string | boolean>(key)
  if (value === null)
    return defaultValue ?? null

  if (typeof value === 'boolean')
    return value

  return value === 'true'
}

function resetCache(): void {
  _isAvailable = null
}

export const storage = {
  get,
  set,
  remove,
  getNumber,
  getBoolean,
  isAvailable: isLocalStorageAvailable,
  resetCache,
}
