import type { SearchDocument } from './search'
import { describe, expect, it } from 'vite-plus/test'
import { searchCommands } from './search'

const DOCUMENTS: readonly SearchDocument[] = [
  {
    path: 'export studio-app',
    description: "Export a studio app's DSL configuration as YAML",
    effect: 'read',
    flags: [{ name: 'include-secret', description: 'include encrypted secret values' }],
    agentGuide: 'Back up an app definition and recreate it elsewhere.',
  },
  {
    path: 'get app',
    description: "List apps or describe one app's basic info",
    effect: 'read',
    flags: [{ name: 'workspace', description: 'workspace ID' }],
    agentGuide: 'List apps to find ids and modes before running one.',
  },
  {
    path: 'run app',
    description: 'Run an app and print the response',
    effect: 'write',
    flags: [{ name: 'inputs', description: 'structured app inputs' }],
    agentGuide: 'Run an app with its input schema.',
  },
]

describe('searchCommands', () => {
  it('ranks path matches above descriptive matches and folds simple plurals', () => {
    const results = searchCommands('export apps', DOCUMENTS)

    expect(results[0]).toEqual({
      path: 'export studio-app',
      description: "Export a studio app's DSL configuration as YAML",
      effect: 'read',
      score: 8,
    })
    expect(results.findIndex(({ path }) => path === 'get app')).toBeGreaterThan(0)
  })

  it('uses flag and guide tokens without counting repeated words', () => {
    const results = searchCommands('encrypted recreate', DOCUMENTS)

    expect(results).toEqual([
      {
        path: 'export studio-app',
        description: "Export a studio app's DSL configuration as YAML",
        effect: 'read',
        score: 2,
      },
    ])
  })

  it('breaks equal scores by path', () => {
    const results = searchCommands('app', DOCUMENTS)

    expect(results.map(({ path }) => path)).toEqual(['export studio-app', 'get app', 'run app'])
  })

  it('returns no candidates for an intent without searchable tokens', () => {
    expect(searchCommands('---', DOCUMENTS)).toEqual([])
  })
})
