import type { Buffer } from 'node:buffer'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import * as https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHttpClient } from './client.js'

function generateSelfSignedCert(dir: string): { key: Buffer, cert: Buffer } {
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
}

// A real server, not a fetch mock, so this also covers Bun's native `tls`
// fetch option (ignored by Node, which only reads undici's `dispatcher`).
describe('createHttpClient against a real self-signed TLS server', () => {
  let server: https.Server
  let baseURL: string
  let certDir: string

  beforeAll(async () => {
    certDir = mkdtempSync(join(tmpdir(), 'difyctl-tls-test-'))
    const { key, cert } = generateSelfSignedCert(certDir)
    server = https.createServer({ key, cert }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>(resolve => server.listen(0, resolve))
    const port = (server.address() as AddressInfo).port
    baseURL = `https://localhost:${port}/`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(certDir, { recursive: true, force: true })
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
