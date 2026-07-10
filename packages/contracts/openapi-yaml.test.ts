import { describe, expect, it } from 'vitest'
import { loadOpenApiYaml } from './openapi-yaml'

describe('loadOpenApiYaml', () => {
  it('preserves merge keys and timestamps used by v4 documents', () => {
    const document = loadOpenApiYaml(`
defaults: &defaults
  version: 2026-07-10T03:04:05Z
info:
  <<: *defaults
`)

    expect(document).toEqual({
      defaults: { version: new Date('2026-07-10T03:04:05Z') },
      info: { version: new Date('2026-07-10T03:04:05Z') },
    })
  })

  it('rejects duplicate mapping keys', () => {
    expect(() => loadOpenApiYaml('openapi: 3.0.0\nopenapi: 3.1.0\n'))
      .toThrow(/duplicated mapping key/)
  })

  it('rejects multiple YAML documents', () => {
    expect(() => loadOpenApiYaml('openapi: 3.0.0\n---\nopenapi: 3.1.0\n'))
      .toThrow(/single document/)
  })

  it('uses v5 mapping and set semantics', () => {
    expect(() => loadOpenApiYaml('? [name, region]\n: deployment\n'))
      .toThrow(/does not support complex keys/)
    expect(loadOpenApiYaml('features: !!set\n  workflow:\n  chat:\n'))
      .toEqual({ features: new Set(['workflow', 'chat']) })
  })
})
