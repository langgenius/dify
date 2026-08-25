import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  getWebAppApiPath,
  getWebAppPublicApiPath,
  parseWebAppAddress,
  resolveWebAppAddress,
} from './webapp-address'

describe('WebAppAddress', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses ordinary and environment workflow addresses without using the app code format', () => {
    expect(parseWebAppAddress('/workflow/env-prefix-is-still-ordinary')).toEqual({
      kind: 'default',
      code: 'env-prefix-is-still-ordinary',
    })
    expect(parseWebAppAddress('/environment/workflow/workflow-app')).toEqual({
      kind: 'environment',
      code: 'workflow-app',
    })
  })

  it('does not reinterpret an unsupported environment path as an ordinary webapp', () => {
    expect(parseWebAppAddress('/environment/workflow')).toBeNull()
    expect(parseWebAppAddress('/environment/not-a-mode/workflow-app')).toBeNull()
  })

  it('accepts every webapp mode under the environment prefix', () => {
    expect(parseWebAppAddress('/environment/chat/chat-app')).toEqual({
      kind: 'environment',
      code: 'chat-app',
    })
  })

  it('builds the environment upload and workflow URLs', () => {
    const address = parseWebAppAddress('/environment/workflow/workflow-app')
    expect(getWebAppApiPath(address, '/files/upload')).toBe(
      '/environment/workflow-app/files/upload',
    )
    expect(getWebAppApiPath(address, '/workflows/run')).toBe(
      '/environment/workflow-app/workflows/run',
    )
    expect(getWebAppApiPath(address, '/workflows/tasks/task-1/stop')).toBe(
      '/environment/workflow-app/workflows/tasks/task-1/stop',
    )
  })

  it('routes only environment login status to the environment API', () => {
    const address = parseWebAppAddress('/environment/workflow/workflow-app')

    expect(getWebAppPublicApiPath(address, '/login/status?user_id=user-1')).toBe(
      '/environment/workflow-app/login/status?user_id=user-1',
    )
    expect(getWebAppPublicApiPath(address, '/login')).toBe('/login')
    expect(getWebAppPublicApiPath(address, '/logout')).toBe('/logout')
    expect(getWebAppPublicApiPath(address, '/email-code-login/validity')).toBe(
      '/email-code-login/validity',
    )
    expect(getWebAppPublicApiPath(address, '/forgot-password')).toBe('/forgot-password')
    expect(getWebAppPublicApiPath(address, '/enterprise/sso/members/oidc/login')).toBe(
      '/enterprise/sso/members/oidc/login',
    )
  })

  it('does not resolve a browser address during server rendering', () => {
    vi.stubGlobal('location', undefined)

    expect(resolveWebAppAddress()).toBeNull()
  })
})
