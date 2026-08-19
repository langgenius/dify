import type { ActionItem } from '../types'
import { slashCommandRegistry } from '../commands/registry'
import { createActions, getActionSearchTerm, matchAction } from '../index'

vi.mock('../app', () => ({
  appAction: {
    key: '@app',
    shortcut: '@app',
    title: 'Apps',
    description: 'Search apps',
    source: 'remote',
  } satisfies ActionItem,
}))

vi.mock('../knowledge', () => ({
  knowledgeAction: {
    key: '@knowledge',
    shortcut: '@kb',
    title: 'Knowledge',
    description: 'Search knowledge',
    source: 'remote',
  } satisfies ActionItem,
}))

vi.mock('../plugin', () => ({
  pluginAction: {
    key: '@plugin',
    shortcut: '@plugin',
    title: 'Plugins',
    description: 'Search plugins',
    source: 'remote',
  } satisfies ActionItem,
}))

vi.mock('../commands/slash', () => ({
  slashAction: {
    key: '/',
    shortcut: '/',
    title: 'Commands',
    description: 'Slash commands',
    source: 'local',
    search: vi.fn(() => []),
  } satisfies ActionItem,
}))

vi.mock('../workflow-nodes', () => ({
  workflowNodesAction: {
    key: '@node',
    shortcut: '@node',
    title: 'Workflow Nodes',
    description: 'Search workflow nodes',
    source: 'local',
    search: vi.fn(() => []),
  } satisfies ActionItem,
}))

vi.mock('../rag-pipeline-nodes', () => ({
  ragPipelineNodesAction: {
    key: '@node',
    shortcut: '@node',
    title: 'RAG Pipeline Nodes',
    description: 'Search RAG nodes',
    source: 'local',
    search: vi.fn(() => []),
  } satisfies ActionItem,
}))

vi.mock('../commands/registry')

describe('createActions', () => {
  it('returns only global actions outside graph pages', () => {
    expect(createActions(false, false)).toEqual(
      expect.objectContaining({ slash: expect.any(Object), app: expect.any(Object) }),
    )
    expect(createActions(false, false)).not.toHaveProperty('node')
  })

  it('uses the workflow-owned node action on workflow pages', () => {
    expect((createActions(true, false) as Record<string, ActionItem>).node!.title).toBe(
      'Workflow Nodes',
    )
  })

  it('uses the RAG-owned node action when both graph flags are true', () => {
    expect((createActions(true, true) as Record<string, ActionItem>).node!.title).toBe(
      'RAG Pipeline Nodes',
    )
  })
})

describe('getActionSearchTerm', () => {
  it('removes either the action key or shortcut', () => {
    const action = createActions(false, false).knowledge

    expect(getActionSearchTerm('@knowledge vector store', action)).toBe('vector store')
    expect(getActionSearchTerm('@kb vector store', action)).toBe('vector store')
  })
})

describe('matchAction', () => {
  const actions = createActions(false, false)

  beforeEach(() => {
    vi.mocked(slashCommandRegistry.getAllCommands).mockReturnValue([])
  })

  it.each([
    ['@app query', '@app'],
    ['@kb query', '@knowledge'],
    ['@plugin query', '@plugin'],
  ])('matches %s', (query, key) => {
    expect(matchAction(query, actions)?.key).toBe(key)
  })

  it('matches complete submenu commands but leaves direct commands in the command picker', () => {
    vi.mocked(slashCommandRegistry.getAllCommands).mockReturnValue([
      { name: 'theme', mode: 'submenu', description: '', search: vi.fn(() => []) },
      { name: 'docs', mode: 'direct', description: '', search: vi.fn(() => []) },
    ])

    expect(matchAction('/theme dark', actions)?.key).toBe('/')
    expect(matchAction('/docs', actions)).toBeUndefined()
    expect(matchAction('/the', actions)).toBeUndefined()
  })
})
