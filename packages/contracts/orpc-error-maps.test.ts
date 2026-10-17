import { describe, expect, it } from 'vite-plus/test'
import { consoleRouterContract } from './generated/api/console/router.gen.ts'
import { contract as openapiContract } from './generated/api/openapi/orpc.gen.ts'
import { contract as serviceContract } from './generated/api/service/orpc.gen.ts'
import { contract as webContract } from './generated/api/web/orpc.gen.ts'

type ErrorMapEntry = { data?: unknown }

const errorEntries = (contract: unknown, trail: string[] = []): [string, ErrorMapEntry][] => {
  if (typeof contract !== 'object' || contract === null) return []
  const definition = (contract as { '~orpc'?: { errorMap?: Record<string, ErrorMapEntry> } })[
    '~orpc'
  ]
  if (definition)
    return Object.entries(definition.errorMap ?? {}).map(([code, entry]) => [
      `${trail.join('.')} ${code}`,
      entry,
    ])
  return Object.entries(contract).flatMap(([key, child]) => errorEntries(child, [...trail, key]))
}

describe('generated oRPC error maps', () => {
  it.each([
    ['console', consoleRouterContract],
    ['openapi', openapiContract],
    ['service', serviceContract],
    ['web', webContract],
  ])('gives every documented %s error a body schema', (_name, contract) => {
    const incomplete = errorEntries(contract)
      .filter(([, entry]) => entry.data === undefined)
      .map(([name]) => name)

    expect(incomplete).toEqual([])
  })

  // /openapi/v1 documents no per-operation business errors yet: its guards raise only
  // errors the surfaces treat as generic, which the open default error covers.
  it.each([
    ['console', consoleRouterContract],
    ['service', serviceContract],
    ['web', webContract],
  ])('declares business errors on %s operations', (_name, contract) => {
    expect(errorEntries(contract).length).toBeGreaterThan(0)
  })
})
