import { consoleRouterContract } from '@dify/contracts/console'
import { describe, expect, it } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { domainOf } from '../mutation-invalidation'
import { createConsolePolicies } from '../query-policies'

type Procedure = { path: string[]; method: string }
type Tree = { [segment: string]: unknown }

const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null

function collectProcedures(node: unknown, path: string[] = []): Procedure[] {
  if (!isTree(node)) return []
  const definition = node['~orpc']
  if (isTree(definition) && isTree(definition.route))
    return [{ path, method: String(definition.route.method ?? 'POST') }]
  return Object.entries(node).flatMap(([segment, child]) =>
    collectProcedures(child, [...path, segment]),
  )
}

const procedures = collectProcedures(consoleRouterContract)
const writes = procedures.filter((procedure) => procedure.method !== 'GET')
const reads = procedures.filter((procedure) => procedure.method === 'GET')
const policies: unknown = createConsolePolicies(consoleQuery)

type MutationPolicy = {
  onSuccess?: unknown
  onSettled?: unknown
  meta?: { invalidate?: false; alsoInvalidate?: readonly string[] }
}

function mutationPolicyOf(path: string[]): MutationPolicy | undefined {
  let node: unknown = policies
  for (const segment of path) node = isTree(node) ? node[segment] : undefined
  return isTree(node) && isTree(node.mutationOptions)
    ? (node.mutationOptions as MutationPolicy)
    : undefined
}

const startsWith = (path: string[], prefix: string) => {
  const segments = prefix.split('.')
  return segments.every((segment, index) => path[index] === segment)
}

// Something for the fallback to refresh: a read under one of the paths.
const hasReadUnder = (prefixes: string[]) =>
  reads.some((read) => prefixes.some((prefix) => startsWith(read.path, prefix)))

describe('console mutation coverage', () => {
  it('finds the contract procedures', () => {
    expect(writes.length).toBeGreaterThan(100)
    expect(reads.length).toBeGreaterThan(100)
  })

  it('covers every write by a policy, the invalidation fallback, or an explicit opt-out', () => {
    const uncovered = writes
      .filter(({ path }) => {
        const policy = mutationPolicyOf(path)
        if (policy?.onSuccess || policy?.onSettled) return false
        if (policy?.meta?.invalidate === false) return false
        return !hasReadUnder([domainOf(path), ...(policy?.meta?.alsoInvalidate ?? [])])
      })
      .map(({ path }) => path.join('.'))

    // Add a policy, an `alsoInvalidate` domain, or `invalidate: false` in `policies/invalidation.ts`.
    expect(uncovered).toEqual([])
  })

  it('declares alsoInvalidate only with paths that have reads', () => {
    const unknown = writes.flatMap(({ path }) =>
      (mutationPolicyOf(path)?.meta?.alsoInvalidate ?? [])
        .filter((target) => !hasReadUnder([target]))
        .map((target) => `${path.join('.')} -> ${target}`),
    )

    expect(unknown).toEqual([])
  })
})
