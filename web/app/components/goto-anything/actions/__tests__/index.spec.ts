import type { ActionItem, SearchResult } from '../types'
import type { DataSet } from '@/models/datasets'
import type { App } from '@/types/app'
import { slashCommandRegistry } from '../commands/registry'
import { createActions, matchAction, searchAnything } from '../index'

vi.mock('../app', () => ({
  appAction: {
    key: '@app',
    shortcut: '@app',
    title: 'Apps',
    description: 'Search apps',
    search: vi.fn().mockResolvedValue([]),
  } satisfies ActionItem,
}))

vi.mock('../knowledge', () => ({
  knowledgeAction: {
    key: '@knowledge',
    shortcut: '@kb',
    title: 'Knowledge',
    description: 'Search knowledge',
    search: vi.fn().mockResolvedValue([]),
  } satisfies ActionItem,
}))

vi.mock('../plugin', () => ({
  pluginAction: {
    key: '@plugin',
    shortcut: '@plugin',
    title: 'Plugins',
    description: 'Search plugins',
    search: vi.fn().mockResolvedValue([]),
  } satisfies ActionItem,
}))

vi.mock('../commands', () => ({
  slashAction: {
    key: '/',
    shortcut: '/',
    title: 'Commands',
    description: 'Slash commands',
    search: vi.fn().mockResolvedValue([]),
  } satisfies ActionItem,
}))

vi.mock('../workflow-nodes', () => ({
  workflowNodesAction: {
    key: '@node',
    shortcut: '@node',
    title: 'Workflow Nodes',
    description: 'Search workflow nodes',
    search: vi.fn().mockResolvedValue([]),
  } satisfies ActionItem,
}))

vi.mock('../rag-pipeline-nodes', () => ({
  ragPipelineNodesAction: {
    key: '@node',
    shortcut: '@node',
    title: 'RAG Pipeline Nodes',
    description: 'Search RAG nodes',
    search: vi.fn().mockResolvedValue([]),
  } satisfies ActionItem,
}))

vi.mock('../commands/registry')

describe('createActions', () => {
  it('returns base actions when neither workflow nor rag-pipeline page', () => {
    const actions = createActions(false, false)

    expect(actions).toHaveProperty('slash')
    expect(actions).toHaveProperty('app')
    expect(actions).toHaveProperty('knowledge')
    expect(actions).toHaveProperty('plugin')
    expect(actions).not.toHaveProperty('node')
  })

  it('includes workflow nodes action on workflow pages', () => {
    const actions = createActions(true, false) as Record<string, ActionItem>

    expect(actions).toHaveProperty('node')
    expect(actions.node.title).toBe('Workflow Nodes')
  })

  it('includes rag-pipeline nodes action on rag-pipeline pages', () => {
    const actions = createActions(false, true) as Record<string, ActionItem>

    expect(actions).toHaveProperty('node')
    expect(actions.node.title).toBe('RAG Pipeline Nodes')
  })

  it('rag-pipeline page takes priority over workflow page', () => {
    const actions = createActions(true, true) as Record<string, ActionItem>

    expect(actions.node.title).toBe('RAG Pipeline Nodes')
  })
})

describe('searchAnything', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to specific action when actionItem is provided', async () => {
    const mockResults: SearchResult[] = [
      { id: '1', title: 'App1', type: 'app', data: {} as unknown as App },
    ]
    const action: ActionItem = {
      key: '@app',
      shortcut: '@app',
      title: 'Apps',
      description: 'Search apps',
      search: vi.fn().mockResolvedValue(mockResults),
    }

    const results = await searchAnything('en', '@app myquery', action)

    expect(action.search).toHaveBeenCalledWith('@app myquery', 'myquery', 'en')
    expect(results).toEqual(mockResults)
  })

  it('strips action prefix from search term', async () => {
    const action: ActionItem = {
      key: '@knowledge',
      shortcut: '@kb',
      title: 'KB',
      description: 'Search KB',
      search: vi.fn().mockResolvedValue([]),
    }

    await searchAnything('en', '@kb hello', action)

    expect(action.search).toHaveBeenCalledWith('@kb hello', 'hello', 'en')
  })

  it('returns empty for queries starting with @ without actionItem', async () => {
    const results = await searchAnything('en', '@unknown')
    expect(results).toEqual([])
  })

  it('returns empty for queries starting with / without actionItem', async () => {
    const results = await searchAnything('en', '/theme')
    expect(results).toEqual([])
  })

  it('handles action search failure gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const action: ActionItem = {
      key: '@app',
      shortcut: '@app',
      title: 'Apps',
      description: 'Search apps',
      search: vi.fn().mockRejectedValue(new Error('network error')),
    }

    const results = await searchAnything('en', '@app test', action)
    expect(results).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Search failed for @app'),
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })

  it('runs global search across all non-slash actions for plain queries', async () => {
    const appResults: SearchResult[] = [
      { id: 'a1', title: 'My App', type: 'app', data: {} as unknown as App },
    ]
    const kbResults: SearchResult[] = [
      { id: 'k1', title: 'My KB', type: 'knowledge', data: {} as unknown as DataSet },
    ]

    const dynamicActions: Record<string, ActionItem> = {
      slash: { key: '/', shortcut: '/', title: 'Slash', description: '', search: vi.fn().mockResolvedValue([]) },
      app: { key: '@app', shortcut: '@app', title: 'App', description: '', search: vi.fn().mockResolvedValue(appResults) },
      knowledge: { key: '@knowledge', shortcut: '@kb', title: 'KB', description: '', search: vi.fn().mockResolvedValue(kbResults) },
    }

    const results = await searchAnything('en', 'my query', undefined, dynamicActions)

    expect(dynamicActions.slash.search).not.toHaveBeenCalled()
    expect(results).toHaveLength(2)
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'a1' }),
      expect.objectContaining({ id: 'k1' }),
    ]))
  })

  it('handles partial search failures in global search gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dynamicActions: Record<string, ActionItem> = {
      app: { key: '@app', shortcut: '@app', title: 'App', description: '', search: vi.fn().mockRejectedValue(new Error('fail')) },
      knowledge: {
        key: '@knowledge',
        shortcut: '@kb',
        title: 'KB',
        description: '',
        search: vi.fn().mockResolvedValue([
          { id: 'k1', title: 'KB1', type: 'knowledge', data: {} as unknown as DataSet },
        ]),
      },
    }

    const results = await searchAnything('en', 'query', undefined, dynamicActions)

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('k1')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('matchAction', () => {
  const actions: Record<string, ActionItem> = {
    app: { key: '@app', shortcut: '@app', title: 'App', description: '', search: vi.fn() },
    knowledge: { key: '@knowledge', shortcut: '@kb', title: 'KB', description: '', search: vi.fn() },
    plugin: { key: '@plugin', shortcut: '@plugin', title: 'Plugin', description: '', search: vi.fn() },
    slash: { key: '/', shortcut: '/', title: 'Slash', description: '', search: vi.fn() },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches @app query', () => {
    const result = matchAction('@app test', actions)
    expect(result?.key).toBe('@app')
  })

  it('matches @kb shortcut', () => {
    const result = matchAction('@kb test', actions)
    expect(result?.key).toBe('@knowledge')
  })

  it('matches @plugin query', () => {
    const result = matchAction('@plugin test', actions)
    expect(result?.key).toBe('@plugin')
  })

  it('returns undefined for unmatched query', () => {
    vi.mocked(slashCommandRegistry.getAllCommands).mockReturnValue([])
    const result = matchAction('random query', actions)
    expect(result).toBeUndefined()
  })

  describe('slash command matching', () => {
    it('matches submenu command with full name', () => {
      vi.mocked(slashCommandRegistry.getAllCommands).mockReturnValue([
        { name: 'theme', mode: 'submenu', description: '', search: vi.fn() },
      ])

      const result = matchAction('/theme', actions)
      expect(result?.key).toBe('/')
    })

    it('matches submenu command with args', () => {
      vi.mocked(slashCommandRegistry.getAllCommands).mockReturnValue([
        { name: 'theme', mode: 'submenu', description: '', search: vi.fn() },
      ])

      const result = matchAction('/theme dark', actions)
      expect(result?.key).toBe('/')
    })

    it('does not match direct-mode commands', () => {
      vi.mocked(slashCommandRegistry.getAllCommands).mockReturnValue([
        { name: 'docs', mode: 'direct', description: '', search: vi.fn() },
      ])

      const result = matchAction('/docs', actions)
      expect(result).toBeUndefined()
    })

    it('does not match partial slash command name', () => {
      vi.mocked(slashCommandRegistry.getAllCommands).mockReturnValue([
        { name: 'theme', mode: 'submenu', description: '', search: vi.fn() },
      ])

      const result = matchAction('/the', actions)
      expect(result).toBeUndefined()
    })
  })
})
