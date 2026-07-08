import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import * as https from 'node:https'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHttpClient } from './client.js'

const FIXTURE_DIR = fileURLToPath(new URL('../../test/fixtures/tls', import.meta.url))

// Real self-signed TLS server: --insecure has to work against Bun's native
// fetch (what the compiled difyctl binary runs on) as well as Node's fetch
// (what these tests run on). Bun's fetch ignores undici's `dispatcher` option
// entirely, so this exercises the actual `tls` fetch option client.ts also
// sets — a fetch mock would hide that gap.
describe('createHttpClient against a real self-signed TLS server', () => {
  let server: https.Server
  let baseURL: string

  beforeAll(async () => {
    server = https.createServer({
      key: readFileSync(`${FIXTURE_DIR}/self-signed-key.pem`),
      cert: readFileSync(`${FIXTURE_DIR}/self-signed-cert.pem`),
    }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>(resolve => server.listen(0, resolve))
    const port = (server.address() as AddressInfo).port
    baseURL = `https://localhost:${port}/`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('rejects the self-signed cert by default', async () => {
    const http = createHttpClient({ baseURL, retryAttempts: 0 })
    await expect(http.get('')).rejects.toBeDefined()
  })

  it('accepts the self-signed cert when insecure: true', async () => {
    const http = createHttpClient({ baseURL, retryAttempts: 0, insecure: true })
    const res = await http.get<{ ok: boolean }>('')
    expect(res.ok).toBe(true)
  })
})
