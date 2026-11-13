import type { ChatItem } from '../types'
import type { AgentLogStreamData } from '@/types/workflow'
import { upsertWorkflowToolActivity } from '../workflow-agent-tool-activity'

const toolLog = (overrides: Partial<AgentLogStreamData> = {}): AgentLogStreamData => ({
  id: 'run-1:call-1',
  node_id: 'agent-node',
  node_execution_id: 'exec-1',
  parent_id: null,
  label: 'shell_run',
  error: null,
  status: 'started',
  data: {
    tool_call_id: 'call-1',
    tool_name: 'shell_run',
    tool_input: '{"command":"ls"}',
    tool_output: '',
    node_title: 'Research agent',
  },
  metadata: { agent_node_version: '2', kind: 'tool' },
  ...overrides,
})

const chatItem = (): ChatItem => ({ id: 'answer-1', content: '', isAnswer: true })

describe('upsertWorkflowToolActivity', () => {
  it('stores a started snapshot keyed by node execution and wire id', () => {
    const item = chatItem()
    upsertWorkflowToolActivity(item, toolLog())

    expect(item.workflowAgentActivities).toHaveLength(1)
    const activity = item.workflowAgentActivities![0]!
    expect(activity.id).toBe('run-1:call-1')
    expect(activity.node_execution_id).toBe('exec-1')
    expect(activity.status).toBe('started')
    expect(activity.data.tool_name).toBe('shell_run')
    expect(activity.data.node_title).toBe('Research agent')
  })

  it('replaces the snapshot for the same call and preserves order', () => {
    const item = chatItem()
    upsertWorkflowToolActivity(item, toolLog())
    upsertWorkflowToolActivity(
      item,
      toolLog({
        id: 'run-1:call-2',
        status: 'started',
        data: {
          tool_call_id: 'call-2',
          tool_name: 'web_search',
          tool_input: '{"q":"dify"}',
          tool_output: '',
          node_title: 'Research agent',
        },
      }),
    )
    upsertWorkflowToolActivity(
      item,
      toolLog({
        status: 'succeeded',
        data: { ...toolLog().data, tool_output: 'a.txt' },
      }),
    )

    expect(item.workflowAgentActivities).toHaveLength(2)
    expect(item.workflowAgentActivities!.map((a) => a.id)).toEqual(['run-1:call-1', 'run-1:call-2'])
    expect(item.workflowAgentActivities![0]!.status).toBe('succeeded')
    expect(item.workflowAgentActivities![0]!.data.tool_output).toBe('a.txt')
    expect(item.workflowAgentActivities![1]!.status).toBe('started')
  })

  it('accepts the running phase and keeps one snapshot per call', () => {
    const item = chatItem()
    const data = toolLog().data

    upsertWorkflowToolActivity(item, toolLog({ status: 'started' }))
    upsertWorkflowToolActivity(
      item,
      toolLog({
        status: 'running',
        data: { ...data, tool_input: '{"script":"ls -la"}' },
      }),
    )

    expect(item.workflowAgentActivities).toHaveLength(1)
    expect(item.workflowAgentActivities![0]!.status).toBe('running')
    expect(item.workflowAgentActivities![0]!.data.tool_input).toBe('{"script":"ls -la"}')

    upsertWorkflowToolActivity(
      item,
      toolLog({
        status: 'succeeded',
        data: { ...data, tool_output: 'a.txt' },
      }),
    )

    expect(item.workflowAgentActivities).toHaveLength(1)
    expect(item.workflowAgentActivities![0]!.status).toBe('succeeded')
  })

  it('keeps same-name parallel calls and different executions distinct', () => {
    const item = chatItem()
    const base = toolLog().data
    upsertWorkflowToolActivity(
      item,
      toolLog({ id: 'run-1:call-a', data: { ...base, tool_call_id: 'call-a' } }),
    )
    upsertWorkflowToolActivity(
      item,
      toolLog({ id: 'run-1:call-b', data: { ...base, tool_call_id: 'call-b' } }),
    )
    upsertWorkflowToolActivity(
      item,
      toolLog({
        id: 'run-1:call-a',
        node_execution_id: 'exec-2',
        data: { ...base, tool_call_id: 'call-a' },
      }),
    )

    expect(item.workflowAgentActivities).toHaveLength(3)
    expect(item.workflowAgentActivities!.map((a) => `${a.node_execution_id}:${a.id}`)).toEqual([
      'exec-1:run-1:call-a',
      'exec-1:run-1:call-b',
      'exec-2:run-1:call-a',
    ])
  })

  it('ignores legacy agent logs and unrelated metadata', () => {
    const item = chatItem()
    upsertWorkflowToolActivity(item, toolLog({ metadata: { provider: 'openai' } }))
    upsertWorkflowToolActivity(
      item,
      toolLog({ metadata: { agent_node_version: '1', kind: 'tool' } }),
    )
    upsertWorkflowToolActivity(item, toolLog({ metadata: { agent_node_version: '2' } }))
    upsertWorkflowToolActivity(item, toolLog({ metadata: undefined }))

    expect(item.workflowAgentActivities).toBeUndefined()
  })

  it('ignores malformed payloads without tool identity', () => {
    const item = chatItem()
    upsertWorkflowToolActivity(item, toolLog({ data: { tool_name: 'shell_run' } }))
    upsertWorkflowToolActivity(item, toolLog({ data: { tool_call_id: 'call-1' } }))
    upsertWorkflowToolActivity(item, toolLog({ id: '' }))
    upsertWorkflowToolActivity(item, toolLog({ status: 'weird' }))
    upsertWorkflowToolActivity(item, toolLog({ node_execution_id: '' }))

    expect(item.workflowAgentActivities).toBeUndefined()
  })

  it('carries terminal failure status and error text', () => {
    const item = chatItem()
    upsertWorkflowToolActivity(item, toolLog({ status: 'failed', error: 'command not found' }))

    const activity = item.workflowAgentActivities![0]!
    expect(activity.status).toBe('failed')
    expect(activity.error).toBe('command not found')
  })
})
