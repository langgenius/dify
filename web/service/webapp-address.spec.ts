import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { getWebAppApiPath, parseWebAppAddress, resolveWebAppAddress } from './webapp-address'

describe('WebAppAddress', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses ordinary and environment workflow addresses without using the app code format', () => {
    expect(parseWebAppAddress('/workflow/env-prefix-is-still-ordinary')).toEqual({
      kind: 'default',
      code: 'env-prefix-is-still-ordinary',
    })
    expect(parseWebAppAddress('/env/workflow/workflow-app')).toEqual({
      kind: 'environment',
      code: 'workflow-app',
    })
  })

  it('does not reinterpret an unsupported environment path as an ordinary webapp', () => {
    expect(parseWebAppAddress('/env/workflow')).toBeNull()
    expect(parseWebAppAddress('/env/not-a-mode/workflow-app')).toBeNull()
  })

  it('accepts every webapp mode under the environment prefix', () => {
    expect(parseWebAppAddress('/env/chat/chat-app')).toEqual({
      kind: 'environment',
      code: 'chat-app',
    })
  })

  it('builds the environment upload and workflow URLs', () => {
    const address = parseWebAppAddress('/env/workflow/workflow-app')
    expect(getWebAppApiPath(address, '/files/upload')).toBe('/env/workflow-app/files/upload')
    expect(getWebAppApiPath(address, '/workflows/run')).toBe('/env/workflow-app/workflows/run')
    expect(getWebAppApiPath(address, '/workflows/tasks/task-1/stop')).toBe(
      '/env/workflow-app/workflows/tasks/task-1/stop',
    )
  })

  it('does not resolve a browser address during server rendering', () => {
    vi.stubGlobal('location', undefined)

    expect(resolveWebAppAddress()).toBeNull()
  })
})
