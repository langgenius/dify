import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum, NOTE_NODE_DATA_TYPE } from '@/app/components/workflow/types'
import {
  fetchWorkflowDraft,
  stopWorkflowRun,
  toNodesDefaultConfigs,
  updateEnvironmentVariables,
} from './workflow'

const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockRequest },
}))

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
    mockRequest.mockResolvedValue({ result: 'success' })

    await updateEnvironmentVariables({
      appId: 'app-1',
      environmentVariables,
      deletedEnvironmentVariableIds: ['env-2'],
    })

    expect(mockRequest).toHaveBeenCalledWith(
      ['apps', 'byAppId', 'workflows', 'draft', 'environmentVariables', 'post'],
      {
        params: { app_id: 'app-1' },
        body: {
          environment_variables: environmentVariables,
          patch: true,
          deleted_environment_variable_ids: ['env-2'],
        },
      },
      expect.any(Object),
    )
  })
})

const createWorkflowResponse = () => ({
  id: 'workflow-1',
  graph: {
    nodes: [
      { id: 'start', position: { x: 0, y: 0 }, data: { type: BlockEnum.Start, title: 'Start' } },
      { id: 'note', type: 'custom-note', data: { type: NOTE_NODE_DATA_TYPE, text: 'hi' } },
    ],
    edges: [],
  },
  features: { opening_statement: 'hello' },
  hash: 'hash-1',
  version: 'draft',
  marked_name: '',
  marked_comment: '',
  created_at: 1,
  updated_at: 2,
  tool_published: false,
  environment_variables: [
    { id: 'env-1', name: 'key', description: '', value_type: 'secret', value: '***' },
  ],
  conversation_variables: [
    { id: 'conv-1', name: 'token', description: '', value_type: 'secret', value: '***' },
  ],
  rag_pipeline_variables: [],
})

describe('fetchWorkflowDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockResolvedValue(createWorkflowResponse())
  })

  it.each([
    [
      { kind: 'app', appId: 'app-1' } as const,
      ['apps', 'byAppId', 'workflows', 'draft', 'get'],
      { params: { app_id: 'app-1' } },
    ],
    [
      { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' } as const,
      ['rag', 'pipelines', 'byPipelineId', 'workflows', 'draft', 'get'],
      { params: { pipeline_id: 'pipeline-1' } },
    ],
  ])('loads the %o draft silently and maps it for the canvas', async (owner, path, input) => {
    const draft = await fetchWorkflowDraft(owner)

    expect(mockRequest).toHaveBeenCalledWith(
      path,
      input,
      expect.objectContaining({ context: { silent: true } }),
    )
    expect(draft.graph.nodes.map((node) => node.data.type)).toEqual([
      BlockEnum.Start,
      NOTE_NODE_DATA_TYPE,
    ])
    expect(draft.environment_variables.map((variable) => variable.id)).toEqual(['env-1'])
    expect(draft.conversation_variables).toEqual([
      { id: 'conv-1', name: 'token', description: '', value_type: 'secret', value: '***' },
    ])
  })
})

describe('stopWorkflowRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockResolvedValue({ result: 'success' })
  })

  it.each([
    [
      { kind: 'app', appId: 'app-1', mode: 'workflow' } as const,
      ['apps', 'byAppId', 'workflowRuns', 'tasks', 'byTaskId', 'stop', 'post'],
      { params: { app_id: 'app-1', task_id: 'task-1' } },
    ],
    [
      { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' } as const,
      ['rag', 'pipelines', 'byPipelineId', 'workflowRuns', 'tasks', 'byTaskId', 'stop', 'post'],
      { params: { pipeline_id: 'pipeline-1', task_id: 'task-1' } },
    ],
    [
      { kind: 'snippet', snippetId: 'snippet-1' } as const,
      ['snippets', 'bySnippetId', 'workflowRuns', 'tasks', 'byTaskId', 'stop', 'post'],
      { params: { snippet_id: 'snippet-1', task_id: 'task-1' } },
    ],
  ])('stops the task of a %o run', async (resource, path, input) => {
    await stopWorkflowRun(resource, 'task-1')

    expect(mockRequest).toHaveBeenCalledWith(path, input, expect.any(Object))
  })
})

describe('toNodesDefaultConfigs', () => {
  it('keys block configs by type and keeps the first config of each type', () => {
    expect(
      toNodesDefaultConfigs([
        { type: 'llm', config: { model: 'a' } },
        { type: 'llm', config: { model: 'b' } },
        { config: { orphan: true } },
        'not a block',
      ]),
    ).toEqual({ llm: { model: 'a' } })
  })
})
