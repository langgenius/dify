import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createKnowledgeFsJwt,
  deleteKnowledgeFsSpaceWithIdentity,
} from '../features/new-rag/support/runtime'

const decode = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('createKnowledgeFsJwt', () => {
  it('binds the interactive Dify identity, tenant, and requested scope', () => {
    try {
      vi.setSystemTime(new Date('2026-07-21T09:00:00.000Z'))
      const token = createKnowledgeFsJwt({
        accountId: 'account-1',
        scope: 'knowledge-spaces:read',
        secret: 'knowledge-fs-smoke-secret-at-least-32-characters',
        tenantId: 'tenant-1',
      })
      const [header, payload, signature] = token.split('.')

      expect(decode(header!)).toEqual({ alg: 'HS256', typ: 'JWT' })
      expect(decode(payload!)).toEqual({
        aud: 'knowledge-fs',
        caller_kind: 'interactive',
        dify_account_id: 'dify-account:account-1',
        exp: 1784624460,
        iat: 1784624400,
        iss: 'dify',
        scopes: ['knowledge-spaces:read'],
        sub: 'dify-workspace:tenant-1',
        tenant_id: 'tenant-1',
      })
      expect(signature).toBe(
        createHmac('sha256', 'knowledge-fs-smoke-secret-at-least-32-characters')
          .update(`${header}.${payload}`)
          .digest('base64url'),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('deleteKnowledgeFsSpaceWithIdentity', () => {
  it('reads the current revision and submits the durable deletion challenge', async () => {
    vi.stubEnv('E2E_NEW_RAG_CONNECTION_CREDENTIALS_JSON', '{"apiKey":"provider-secret"}')
    vi.stubEnv('E2E_NEW_RAG_CRAWL_URL', 'https://docs.example.com')
    vi.stubEnv('E2E_NEW_RAG_KNOWLEDGE_FS_BASE_URL', 'http://127.0.0.1:8788')
    vi.stubEnv(
      'E2E_NEW_RAG_KNOWLEDGE_FS_JWT_SECRET',
      'knowledge-fs-smoke-secret-at-least-32-characters',
    )
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'E2E Knowledge', revision: 3 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetch)

    await deleteKnowledgeFsSpaceWithIdentity('space-1', {
      accountId: 'account-1',
      tenantId: 'tenant-1',
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    const deletion = fetch.mock.calls[1]!
    expect(deletion[0].toString()).toBe('http://127.0.0.1:8788/knowledge-spaces/space-1')
    expect(deletion[1]).toMatchObject({
      body: JSON.stringify({ challenge: 'E2E Knowledge', expectedRevision: 3 }),
      method: 'DELETE',
    })
    expect(new Headers(deletion[1]?.headers).get('Idempotency-Key')).toBe('e2e-delete-space-1')
  })
})
