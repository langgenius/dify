import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  beginWebAppAuthorizationRecovery,
  completeWebAppAuthorizationRecovery,
  getOrCreateWebAppSessionId,
  getWebAppPassport,
  setWebAppPassport,
} from './webapp-auth'

describe('webapp auth storage', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('keeps environment and ordinary passports for the same code separate', () => {
    const environment = { kind: 'environment' as const, code: 'workflow-app' }
    const ordinary = { kind: 'default' as const, code: 'workflow-app' }

    setWebAppPassport(environment, 'environment-passport')
    setWebAppPassport(ordinary, 'ordinary-passport')

    expect(getWebAppPassport(environment)).toBe('environment-passport')
    expect(getWebAppPassport(ordinary)).toBe('ordinary-passport')
    expect(localStorage.getItem('passport-workflow-app')).toBe('ordinary-passport')
  })

  it('keeps a stable user id for each environment', () => {
    const firstEnvironment = { kind: 'environment' as const, code: 'environment-1' }
    const secondEnvironment = { kind: 'environment' as const, code: 'environment-2' }

    const first = getOrCreateWebAppSessionId(firstEnvironment)

    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    expect(getOrCreateWebAppSessionId(firstEnvironment)).toBe(first)
    expect(getOrCreateWebAppSessionId(secondEnvironment)).not.toBe(first)
    expect(localStorage.getItem('session_id-environment:environment-1')).toBe(first)
  })

  it('allows one authorization recovery until an environment request succeeds', () => {
    const address = { kind: 'environment' as const, code: 'environment-1' }

    expect(beginWebAppAuthorizationRecovery(address)).toBe(true)
    expect(beginWebAppAuthorizationRecovery(address)).toBe(false)

    setWebAppPassport(address, 'renewed-passport')

    expect(beginWebAppAuthorizationRecovery(address)).toBe(false)

    completeWebAppAuthorizationRecovery(address)

    expect(beginWebAppAuthorizationRecovery(address)).toBe(true)
  })
})
