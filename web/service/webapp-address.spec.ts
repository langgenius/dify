import { describe, expect, it } from 'vitest'
import { getWebAppApiPath, parseWebAppAddress } from './webapp-address'

describe('WebAppAddress', () => {
  it('parses ordinary and environment workflow addresses without using the app code format', () => {
    expect(parseWebAppAddress('/workflow/env-prefix-is-still-ordinary')).toEqual({
      kind: 'default',
      code: 'env-prefix-is-still-ordinary',
    })
    expect(parseWebAppAddress('/workflow/environments/env-1/workflow-app')).toEqual({
      kind: 'environment',
      environmentId: 'env-1',
      code: 'workflow-app',
    })
  })

  it('does not reinterpret an unsupported environment path as an ordinary webapp', () => {
    expect(parseWebAppAddress('/workflow/environments/env-1')).toBeNull()
  })

  it('builds the environment upload and workflow URLs', () => {
    const address = parseWebAppAddress('/workflow/environments/env-1/workflow-app')
    expect(getWebAppApiPath(address, '/files/upload')).toBe(
      '/environments/env-1/webapps/workflow-app/files/upload',
    )
    expect(getWebAppApiPath(address, '/workflows/run')).toBe(
      '/environments/env-1/webapps/workflow-app/workflows/run',
    )
    expect(getWebAppApiPath(address, '/workflows/tasks/task-1/stop')).toBe(
      '/environments/env-1/webapps/workflow-app/workflows/tasks/task-1/stop',
    )
  })
})
