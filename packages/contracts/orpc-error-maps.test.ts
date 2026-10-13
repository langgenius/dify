import { describe, expect, it } from 'vite-plus/test'
import { consoleRouterContract } from './generated/api/console/router.gen.ts'
import { contract as openapiContract } from './generated/api/openapi/orpc.gen.ts'
import { contract as serviceContract } from './generated/api/service/orpc.gen.ts'
import { contract as webContract } from './generated/api/web/orpc.gen.ts'

type ErrorMapEntry = { status?: number; data?: unknown }

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
  ])('gives every documented %s error a status and a body schema', (_name, contract) => {
    const entries = errorEntries(contract)
    const incomplete = entries
      .filter(([, entry]) => typeof entry.status !== 'number' || entry.data === undefined)
      .map(([name]) => name)

    expect(entries.length).toBeGreaterThan(0)
    expect(incomplete).toEqual([])
  })
})
