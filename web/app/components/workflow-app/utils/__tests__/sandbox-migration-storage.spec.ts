import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSandboxMigrationDismissed, setSandboxMigrationDismissed } from '../sandbox-migration-storage'

const STORAGE_KEY = 'workflow:sandbox-migration-dismissed-app-ids'

describe('sandbox migration storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return false when app id is missing or storage is empty', () => {
    expect(getSandboxMigrationDismissed()).toBe(false)
    expect(getSandboxMigrationDismissed('app-1')).toBe(false)
  })

  it('should return false for invalid stored json', () => {
    window.localStorage.setItem(STORAGE_KEY, '{invalid-json')

    expect(getSandboxMigrationDismissed('app-1')).toBe(false)
  })

  it('should persist dismissed ids without duplicates', () => {
    setSandboxMigrationDismissed('app-1')
    setSandboxMigrationDismissed('app-1')
    setSandboxMigrationDismissed('app-2')

    expect(getSandboxMigrationDismissed('app-1')).toBe(true)
    expect(getSandboxMigrationDismissed('app-2')).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['app-1', 'app-2']))
  })

  it('should fall back to writing only current id when existing value cannot be parsed', () => {
    window.localStorage.setItem(STORAGE_KEY, '{broken')

    setSandboxMigrationDismissed('app-3')

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['app-3']))
  })
})
