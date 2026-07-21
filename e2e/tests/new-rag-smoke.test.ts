import { describe, expect, it } from 'vitest'
import {
  buildNewRagSmokeRuns,
  newRagCucumberArgs,
  resolveNewRagSmokeConfig,
} from '../scripts/run-new-rag-smoke'

const completeEnvironment = {
  E2E_NEW_RAG_CONNECTION_CREDENTIALS_JSON: JSON.stringify({
    base_url: 'http://host.docker.internal:3002',
    firecrawl_api_key: 'firecrawl-secret',
  }),
  E2E_NEW_RAG_CRAWL_URL: 'https://docs.example.com',
  E2E_NEW_RAG_KNOWLEDGE_FS_BASE_URL: 'http://127.0.0.1:8788/',
  E2E_NEW_RAG_KNOWLEDGE_FS_JWT_SECRET: 'knowledge-fs-smoke-secret-at-least-32-characters',
  E2E_CUCUMBER_TAGS: '@stale-caller-tag',
  E2E_REUSE_WEB_SERVER: 'true',
  PATH: '/test/bin',
} satisfies NodeJS.ProcessEnv

describe('resolveNewRagSmokeConfig', () => {
  it('requires every live integration input before the smoke starts', () => {
    expect(() => resolveNewRagSmokeConfig({})).toThrow(
      'E2E_NEW_RAG_KNOWLEDGE_FS_BASE_URL is required',
    )
  })

  it('rejects weak JWT secrets and non-object provider credentials', () => {
    expect(() =>
      resolveNewRagSmokeConfig({
        ...completeEnvironment,
        E2E_NEW_RAG_KNOWLEDGE_FS_JWT_SECRET: 'too-short',
      }),
    ).toThrow('at least 32 characters')

    expect(() =>
      resolveNewRagSmokeConfig({
        ...completeEnvironment,
        E2E_NEW_RAG_CONNECTION_CREDENTIALS_JSON: '[]',
      }),
    ).toThrow('must be a JSON object')
  })

  it('accepts provider-specific credential field names from the live catalog', () => {
    expect(
      resolveNewRagSmokeConfig({
        ...completeEnvironment,
        E2E_NEW_RAG_CONNECTION_CREDENTIALS_JSON: JSON.stringify({ apiKey: 'provider-secret' }),
      }).connectionCredentials,
    ).toEqual({ apiKey: 'provider-secret' })
  })

  it('normalizes the live endpoints without exposing credentials', () => {
    expect(resolveNewRagSmokeConfig(completeEnvironment)).toEqual({
      connectionCredentials: {
        base_url: 'http://host.docker.internal:3002',
        firecrawl_api_key: 'firecrawl-secret',
      },
      crawlUrl: 'https://docs.example.com/',
      knowledgeFsBaseUrl: 'http://127.0.0.1:8788',
      knowledgeFsJwtSecret: 'knowledge-fs-smoke-secret-at-least-32-characters',
    })
  })
})

describe('buildNewRagSmokeRuns', () => {
  it('builds an isolated default, explicit-off, and enabled matrix in order', () => {
    const runs = buildNewRagSmokeRuns(completeEnvironment)

    expect(runs.map(({ label, tag }) => ({ label, tag }))).toEqual([
      { label: 'default-disabled', tag: '@new-rag-flag-default' },
      { label: 'explicit-disabled', tag: '@new-rag-flag-disabled' },
      { label: 'enabled-happy-path', tag: '@new-rag-happy-path' },
    ])

    expect(runs[0]?.env).not.toHaveProperty('KNOWLEDGE_FS_ENABLED')
    expect(runs[0]?.env).not.toHaveProperty('KNOWLEDGE_FS_BASE_URL')
    expect(runs[0]?.env).not.toHaveProperty('KNOWLEDGE_FS_JWT_SECRET')
    expect(runs[1]?.env).toMatchObject({ KNOWLEDGE_FS_ENABLED: 'false' })
    expect(runs[1]?.env).not.toHaveProperty('KNOWLEDGE_FS_BASE_URL')
    expect(runs[2]?.env).toMatchObject({
      KNOWLEDGE_FS_BASE_URL: 'http://127.0.0.1:8788',
      KNOWLEDGE_FS_ENABLED: 'true',
      KNOWLEDGE_FS_JWT_SECRET: 'knowledge-fs-smoke-secret-at-least-32-characters',
    })
    expect(runs[2]?.env.PATH).toBe('/test/bin')
    for (const run of runs) {
      expect(run.env).not.toHaveProperty('E2E_CUCUMBER_TAGS')
      expect(run.env).not.toHaveProperty('E2E_REUSE_WEB_SERVER')
    }
  })
})

describe('newRagCucumberArgs', () => {
  it('runs every matrix entry with a fresh full E2E lifecycle', () => {
    expect(newRagCucumberArgs('@new-rag-happy-path')).toEqual([
      'exec',
      'tsx',
      './scripts/run-cucumber.ts',
      '--full',
      '--',
      '--tags',
      '@new-rag-happy-path',
    ])
  })
})
