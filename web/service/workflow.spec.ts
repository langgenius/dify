import type { DraftWorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fetchAppWorkflowDraft, updateEnvironmentVariables } from './workflow'

const mockPost = vi.hoisted(() => vi.fn())
const mockGetAppDraft = vi.hoisted(() => vi.fn())

const createDraft = (features: DraftWorkflowResponse['features']) =>
  ({
    id: 'draft-1',
    graph: { nodes: [], edges: [] },
    features,
    hash: 'draft-hash',
    last_replacement_id: 'import-1',
    conversation_variables: [],
    environment_variables: [],
    rag_pipeline_variables: [],
    created_at: 1,
    created_by: null,
    updated_at: 2,
    updated_by: null,
    tool_published: false,
    version: 'draft',
    marked_name: '',
    marked_comment: '',
  }) satisfies DraftWorkflowResponse

vi.mock('./base', () => ({
  get: vi.fn(),
  post: mockPost,
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    apps: {
      byAppId: {
        workflows: {
          draft: { get: mockGetAppDraft },
        },
      },
    },
  },
}))

describe('fetchAppWorkflowDraft', () => {
  it('reads the app draft through the generated client without changing its features', async () => {
    const features = {
      annotation_reply: { enabled: true },
      custom_feature: { enabled: true },
      opening_statement: null,
    }
    const draft = createDraft(features)
    mockGetAppDraft.mockResolvedValue(draft)

    const result = await fetchAppWorkflowDraft('app-1')

    expect(mockGetAppDraft).toHaveBeenCalledWith(
      { params: { app_id: 'app-1' } },
      { context: { silent: true } },
    )
    expect(result.features).toBe(features)
    expect(result.features.opening_statement).toBeNull()
    expect(result.last_replacement_id).toBe('import-1')
  })

  it('rejects a graph that cannot be used by the workflow canvas', async () => {
    mockGetAppDraft.mockResolvedValue({
      ...createDraft({}),
      graph: { nodes: 'invalid', edges: [] },
    })

    await expect(fetchAppWorkflowDraft('app-1')).rejects.toThrow('Invalid app workflow draft graph')
  })

  it('loads persisted canvas notes alongside executable workflow nodes', async () => {
    const note = {
      id: 'note-1',
      type: 'custom-note',
      position: { x: 300, y: 100 },
      data: {
        type: '',
        title: '',
        desc: '',
        text: '',
        theme: 'blue',
        author: 'Editor',
        showAuthor: true,
        width: 240,
        height: 88,
      },
    }
    const draft = {
      ...createDraft({}),
      graph: {
        nodes: [
          {
            id: 'start-1',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: { type: 'start', title: 'Start', desc: '' },
          },
          note,
        ],
        edges: [],
      },
    } satisfies DraftWorkflowResponse
    mockGetAppDraft.mockResolvedValue(draft)

    const result = await fetchAppWorkflowDraft('app-1')

    expect(result.graph.nodes).toHaveLength(2)
    expect(result.graph.nodes[1]).toEqual(note)
  })

  it.each([
    { type: 'custom', data: { type: '' } },
    { type: 'custom-note', data: { type: 'unknown-block' } },
  ])('rejects unsupported node data types for the $type renderer', async (node) => {
    mockGetAppDraft.mockResolvedValue({
      ...createDraft({}),
      graph: {
        nodes: [{ ...node, id: 'node-1', position: { x: 0, y: 0 } }],
        edges: [],
      },
    } satisfies DraftWorkflowResponse)

    await expect(fetchAppWorkflowDraft('app-1')).rejects.toThrow('Invalid app workflow draft graph')
  })

  it('rejects malformed known features before updating the workflow UI', async () => {
    mockGetAppDraft.mockResolvedValue(createDraft({ opening_statement: 42 }))

    await expect(fetchAppWorkflowDraft('app-1')).rejects.toThrow(
      'Invalid app workflow draft features',
    )
  })

  it('normalizes partial persisted graph fields without changing the generated response', async () => {
    const graph = {
      nodes: [
        { id: 'node-1', data: { type: 'start', extra: 'kept' }, position: { x: 5, y: 6 } },
        { id: 'node-2', data: { type: 'end' } },
      ],
      edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', data: null }],
    }
    const environmentVariables = [
      { id: 'env-1', name: 'optional', description: '', value_type: 'string', value: null },
    ]
    mockGetAppDraft.mockResolvedValue({
      ...createDraft({}),
      graph,
      environment_variables: environmentVariables,
    })

    const result = await fetchAppWorkflowDraft('app-1')

    expect(result.graph.nodes[0]).toEqual({
      ...graph.nodes[0],
      data: { type: 'start', extra: 'kept', title: '', desc: '' },
    })
    expect(result.graph.nodes[1]).toEqual({
      ...graph.nodes[1],
      position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      data: { type: 'end', title: '', desc: '' },
    })
    expect(result.graph.edges[0]).toEqual({
      ...graph.edges[0],
      data: { sourceType: 'start', targetType: 'end' },
    })
    expect(graph.nodes[1]).not.toHaveProperty('position')
    expect(result.environment_variables).toBe(environmentVariables)
  })

  it('preserves dangling edges without claiming unavailable endpoint types', async () => {
    mockGetAppDraft.mockResolvedValue({
      ...createDraft({}),
      graph: {
        nodes: [{ id: 'node-1', data: { type: 'start' } }],
        edges: [{ id: 'edge-1', source: 'node-1', target: 'missing', data: { label: 'kept' } }],
      },
    })

    const draft = await fetchAppWorkflowDraft('app-1')

    expect(draft.graph.edges[0]).toEqual({
      id: 'edge-1',
      source: 'node-1',
      target: 'missing',
      data: { label: 'kept', sourceType: 'start', targetType: undefined },
    })
  })

  it('retains backend-exposed environment and secret conversation variable types', async () => {
    const draft = {
      ...createDraft({}),
      environment_variables: [
        { id: 'env-boolean', name: 'enabled', description: '', value_type: 'boolean', value: true },
        {
          id: 'env-object',
          name: 'config',
          description: '',
          value_type: 'object',
          value: { a: 1 },
        },
      ],
      conversation_variables: [
        { id: 'conv-secret', name: 'token', description: '', value_type: 'secret', value: null },
      ],
    }
    mockGetAppDraft.mockResolvedValue(draft)

    const result = await fetchAppWorkflowDraft('app-1')

    expect(result.environment_variables).toBe(draft.environment_variables)
    expect(result.conversation_variables).toBe(draft.conversation_variables)
  })
})

describe('updateEnvironmentVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends per-ID upserts and deletions as a patch', async () => {
    const environmentVariables = [
      {
        id: 'env-1',
        name: 'for_summarize',
        description: '',
        value_type: 'llm',
        value: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4.1',
          mode: 'chat',
        },
      },
    ] satisfies EnvironmentVariable[]
    mockPost.mockResolvedValue({ result: 'success' })

    await updateEnvironmentVariables({
      appId: 'app-1',
      environmentVariables,
      deletedEnvironmentVariableIds: ['env-2'],
    })

    expect(mockPost).toHaveBeenCalledWith('apps/app-1/workflows/draft/environment-variables', {
      body: {
        environment_variables: environmentVariables,
        patch: true,
        deleted_environment_variable_ids: ['env-2'],
      },
    })
  })
})
