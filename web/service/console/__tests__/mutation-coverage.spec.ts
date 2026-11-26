import { consoleRouterContract } from '@dify/contracts/console'
import { describe, expect, it } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { domainOf } from '../mutation-invalidation'
import { READ_ONLY_POSTS } from '../policies/invalidation'
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

// Names that usually mean a lookup sent as POST.
const READ_ONLY_NAME =
  /preview|estimate|validat|validity|check|test|download|search|query|capabilit|audioToText|textToAudio|schema|options|nodeInfo|compute|ids\.post|latestVersions/i

// Writes whose names look like lookups, with what they change.
const WRITES_NAMED_LIKE_READS = new Set<string>([
  // Retrieval tests are recorded in the dataset's query history.
  'datasets.byDatasetId.hitTesting.post',
  'datasets.byDatasetId.externalHitTesting.post',
  // Preview jobs, research tasks and archive downloads are created and listed as tasks.
  'knowledgeFs.sourceProviderPreview.jobs.post',
  'knowledgeFs.sourceProviderPreview.jobs.byJobId.delete',
  'knowledgeFs.spaces.byControlSpaceId.researchTasks.post',
  'knowledgeFs.spaces.byControlSpaceId.researchTasks.plan.post',
  'knowledgeFs.spaces.byControlSpaceId.researchTasks.byTaskId.delete',
  'workflowRunArchives.downloads.post',
])

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

  it('opts out every write whose name reads as a lookup, unless it is listed as a real write', () => {
    const readOnly = new Set<string>(READ_ONLY_POSTS)
    const unclassified = writes
      .map(({ path }) => path.join('.'))
      .filter(
        (path) =>
          READ_ONLY_NAME.test(path) &&
          !readOnly.has(path) &&
          !WRITES_NAMED_LIKE_READS.has(path) &&
          // Opted out for another reason, such as sign-in steps and autosaves.
          mutationPolicyOf(path.split('.'))?.meta?.invalidate !== false,
      )

    // A read sent as POST goes in READ_ONLY_POSTS (`policies/invalidation.ts`); a real write here.
    expect(unclassified).toEqual([])
    for (const path of readOnly)
      expect(mutationPolicyOf(path.split('.'))?.meta?.invalidate, path).toBe(false)
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
