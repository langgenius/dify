import type { DifyMock } from '../../test/fixtures/dify-mock/server.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMock } from '../../test/fixtures/dify-mock/server.js'
import { createClient } from '../http/client.js'
import { MetaClient } from './meta.js'

describe('MetaClient', () => {
  let mock: DifyMock

  beforeEach(async () => {
    mock = await startMock()
  })
  afterEach(async () => {
    await mock.stop()
  })

  it('fetches /openapi/v1/_version without a bearer token', async () => {
    const client = new MetaClient(createClient({ host: mock.url }))
    const info = await client.serverVersion()

    expect(info.version).toBe('1.6.4')
    expect(info.edition).toBe('CLOUD')
  })

  it('honors the auth-expired scenario by allowing the unauthed endpoint anyway', async () => {
    mock.setScenario('auth-expired')
    const client = new MetaClient(createClient({ host: mock.url }))
    const info = await client.serverVersion()

    // The meta endpoint is exempt from auth middleware, so an auth-expired
    // session does not stop the version probe.
    expect(info.version).toBe('1.6.4')
  })

  it('returns an empty version string when the server scenario forces it', async () => {
    mock.setScenario('server-version-empty')
    const client = new MetaClient(createClient({ host: mock.url }))
    const info = await client.serverVersion()

    expect(info.version).toBe('')
    expect(info.edition).toBe('SELF_HOSTED')
  })

  it('throws when the host has no Dify on it', async () => {
    // Closed port — connection refused.
    const client = new MetaClient(createClient({ host: 'http://127.0.0.1:1' }))
    await expect(client.serverVersion()).rejects.toBeDefined()
  })
})
