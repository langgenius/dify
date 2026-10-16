import type {
  PipelineVariableResponse,
  WorkflowGraphResponse,
  WorkflowRunNodeExecutionResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { TransferMethod } from '@/types/app'
import { NODE_WIDTH_X_OFFSET, START_INITIAL_POSITION } from '../../constants'
import formatAgentLog from '../../run/utils/format-log/agent'
import { BlockEnum, NOTE_NODE_DATA_TYPE } from '../../types'
import {
  toCanvasGraph,
  toConversationVariables,
  toEnvironmentVariables,
  toFeaturesData,
  toNodeTracing,
  toPipelineVariables,
  UnknownWorkflowBlockError,
  UnsupportedWorkflowVariableError,
} from '../workflow-response'

describe('toCanvasGraph', () => {
  it('keeps note nodes and fills node defaults the canvas needs', () => {
    const graph: WorkflowGraphResponse = {
      nodes: [
        {
          id: 'start',
          position: { x: 10, y: 20 },
          data: { type: BlockEnum.Start, title: 'Start' },
        },
        { id: 'note', type: 'custom-note', data: { type: NOTE_NODE_DATA_TYPE, text: 'hi' } },
      ],
      edges: [],
      viewport: { x: 1, y: 2, zoom: 0.5 },
    }

    const { nodes, viewport } = toCanvasGraph(graph)

    expect(nodes[0]).toMatchObject({
      id: 'start',
      position: { x: 10, y: 20 },
      data: { type: BlockEnum.Start, title: 'Start', desc: '' },
    })
    expect(nodes[1]).toMatchObject({
      type: 'custom-note',
      position: { x: START_INITIAL_POSITION.x + NODE_WIDTH_X_OFFSET, y: START_INITIAL_POSITION.y },
      data: { type: NOTE_NODE_DATA_TYPE, title: '', text: 'hi' },
    })
    expect(viewport).toEqual({ x: 1, y: 2, zoom: 0.5 })
  })

  it('refuses graphs with blocks this client does not know', () => {
    expect(() => toCanvasGraph({ nodes: [{ id: 'x', data: { type: 'future-block' } }] })).toThrow(
      UnknownWorkflowBlockError,
    )
  })

  it('derives missing edge ids and endpoint types from the connected nodes', () => {
    const { edges } = toCanvasGraph({
      nodes: [
        { id: 'a', data: { type: BlockEnum.Start } },
        { id: 'b', data: { type: BlockEnum.LLM } },
      ],
      edges: [{ source: 'a', target: 'b', data: { isInIteration: false } }],
    })

    expect(edges[0]).toMatchObject({
      id: 'a-source-b-target',
      data: { sourceType: BlockEnum.Start, targetType: BlockEnum.LLM, isInIteration: false },
    })
  })
})

describe('variables', () => {
  it('maps environment variables, including LLM values', () => {
    expect(
      toEnvironmentVariables([
        { id: '1', name: 'key', description: '', value_type: 'secret', value: '***' },
        {
          id: '2',
          name: 'model',
          description: '',
          value_type: 'llm',
          value: { provider: 'openai', name: 'gpt', mode: 'chat' },
        },
      ]).map((variable) => [variable.id, variable.value_type]),
    ).toEqual([
      ['1', 'secret'],
      ['2', 'llm'],
    ])
  })

  it.each([
    { id: '1', name: 'count', description: '', value_type: 'number', value: 'nope' },
    { id: '2', name: 'list', description: '', value_type: 'array[string]', value: [] },
  ])('refuses environment variables it cannot keep: %o', (variable) => {
    expect(() => toEnvironmentVariables([variable])).toThrow(UnsupportedWorkflowVariableError)
  })

  it('keeps secret conversation variables', () => {
    expect(
      toConversationVariables([
        { id: '1', name: 'a', description: '', value_type: 'string', value: '' },
        { id: '2', name: 'token', description: '', value_type: 'secret', value: '***' },
      ]).map((variable) => variable.value_type),
    ).toEqual(['string', 'secret'])
  })

  it('refuses conversation variables of unknown types', () => {
    expect(() =>
      toConversationVariables([
        { id: '1', name: 'b', description: '', value_type: 'unknown', value: '' },
      ]),
    ).toThrow(UnsupportedWorkflowVariableError)
  })

  const pipelineVariable = (overrides: Partial<PipelineVariableResponse> = {}) => ({
    variable: 'doc',
    label: 'Doc',
    type: 'file',
    belong_to_node_id: 'shared',
    required: true,
    ...overrides,
  })

  it.each([
    pipelineVariable({ type: 'future-input' }),
    pipelineVariable({ default_value: ['a'] }),
    pipelineVariable({ allowed_file_types: ['image', 'hologram'] }),
    pipelineVariable({ allowed_file_upload_methods: ['local_file', 'carrier_pigeon'] }),
  ])('refuses lossy pipeline variables only when strict: %o', (variable) => {
    expect(() => toPipelineVariables([variable], { strict: true })).toThrow(
      UnsupportedWorkflowVariableError,
    )
    expect(toPipelineVariables([variable]).length).toBeLessThanOrEqual(1)
  })
})

describe('toFeaturesData', () => {
  it('maps stored features and applies panel defaults', () => {
    const uploadConfig = createFileUploadConfigFixture()
    const features = toFeaturesData(
      {
        file_upload: {
          enabled: true,
          allowed_file_upload_methods: [TransferMethod.local_file, 'carrier_pigeon'],
          image: { enabled: true, number_limits: 5, transfer_methods: [TransferMethod.remote_url] },
        },
        text_to_speech: { enabled: true, autoPlay: 'enabled' },
        retriever_resource: { enabled: true },
      },
      uploadConfig,
    )

    expect(features).toMatchObject({
      file: {
        enabled: true,
        allowed_file_upload_methods: [TransferMethod.local_file],
        image: { enabled: true, number_limits: 5, transfer_methods: [TransferMethod.remote_url] },
        number_limits: 5,
        fileUploadConfig: uploadConfig,
      },
      text2speech: { enabled: true, autoPlay: 'enabled' },
      citation: { enabled: true },
      suggested: { enabled: false },
      moderation: { enabled: false },
    })
  })

  it('keeps the opening enabled when only suggested questions are set', () => {
    expect(toFeaturesData({ suggested_questions: ['Q1'] }).opening).toEqual({
      enabled: true,
      opening_statement: undefined,
      suggested_questions: ['Q1'],
    })
  })
})

describe('toNodeTracing', () => {
  const execution = (
    overrides: Partial<WorkflowRunNodeExecutionResponse> = {},
  ): WorkflowRunNodeExecutionResponse => ({
    id: 'exec-1',
    node_id: 'llm',
    node_type: BlockEnum.LLM,
    title: 'LLM',
    status: 'succeeded',
    ...overrides,
  })

  it('maps execution metadata and narrows the error strategy', () => {
    const [tracing] = toNodeTracing(
      execution({
        execution_metadata: {
          total_tokens: 3,
          error_strategy: 'fail-branch',
          agent_log: [{ label: 'think', status: 'success' }],
        },
        created_by_account: { id: 'u1', name: 'Alice', email: 'a@example.com' },
      }),
    )

    expect(tracing).toMatchObject({
      node_type: BlockEnum.LLM,
      created_by: { name: 'Alice' },
      execution_metadata: {
        total_tokens: 3,
        total_price: 0,
        error_strategy: 'fail-branch',
        agent_log: [{ label: 'think', status: 'success', node_id: '' }],
      },
    })
  })

  it('keeps legacy agent logs identified by id linkable into a tree', () => {
    const [tracing] = toNodeTracing(
      execution({
        node_type: BlockEnum.Agent,
        execution_metadata: {
          agent_log: [
            { id: 'round-1', label: 'Round 1', status: 'success' },
            { id: 'tool-1', parent_id: 'round-1', label: 'Search', status: 'success' },
          ],
        },
      }),
    )

    const agentLog = tracing?.execution_metadata?.agent_log ?? []
    expect(agentLog.map((log) => log.message_id)).toEqual(['round-1', 'tool-1'])
    expect(formatAgentLog(tracing ? [tracing] : [])[0]?.agentLog).toEqual([
      expect.objectContaining({
        message_id: 'round-1',
        children: [expect.objectContaining({ message_id: 'tool-1' })],
      }),
    ])
  })

  it('leaves the agent log tree empty for Agent V2 run metadata', () => {
    const [tracing] = toNodeTracing(
      execution({
        node_type: BlockEnum.AgentV2,
        execution_metadata: {
          agent_log: { agent_backend: { run_id: 'run-1', status: 'succeeded' } },
          total_tokens: 21,
        },
      }),
    )

    expect(tracing?.execution_metadata).toMatchObject({ total_tokens: 21, agent_log: undefined })
  })

  it('skips executions of unknown block types', () => {
    expect(toNodeTracing(execution({ node_type: 'future-block' }))).toEqual([])
  })
})
