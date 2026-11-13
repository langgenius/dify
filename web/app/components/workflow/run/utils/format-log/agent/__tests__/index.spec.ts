import type { AgentLogItem, NodeTracing } from '@/types/workflow'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import format from '..'

const createTrace = (
  agentLog: AgentLogItem[],
  nodeType: BlockEnum = BlockEnum.Agent,
): NodeTracing =>
  createNodeTracing({
    node_id: 'agent-node',
    node_type: nodeType,
    execution_metadata: {
      total_tokens: 0,
      total_price: 0,
      currency: 'USD',
      agent_log: agentLog,
    },
  })

const createLog = (messageId: string, parentId?: string): AgentLogItem => ({
  message_id: messageId,
  parent_id: parentId,
  node_execution_id: 'execution-1',
  node_id: 'agent-node',
  label: messageId,
  data: {},
  status: 'succeeded',
})

describe('agent format log', () => {
  it('should transform flat agent logs into a tree', () => {
    const [result] = format([
      createTrace([
        createLog('root'),
        createLog('child-1', 'root'),
        createLog('child-2', 'root'),
        createLog('grandchild', 'child-1'),
      ]),
    ])

    expect(result!.agentLog).toEqual([
      expect.objectContaining({
        message_id: 'root',
        children: [
          expect.objectContaining({
            message_id: 'child-1',
            children: [expect.objectContaining({ message_id: 'grandchild' })],
          }),
          expect.objectContaining({ message_id: 'child-2' }),
        ],
      }),
    ])
  })

  it('should remove one-step circle log entries', () => {
    const [result] = format([createTrace([createLog('root'), createLog('root', 'root')])])

    expect(result!.agentLog).toEqual([
      expect.objectContaining({
        message_id: 'root',
        hasCircle: true,
        children: [],
      }),
    ])
  })

  it('should not attach agent logs to unsupported node types', () => {
    const [result] = format([createTrace([createLog('root')], BlockEnum.Start)])

    expect(result!.agentLog).toEqual([])
  })

  it('should read agent process entries recorded by the Agent V2 node', () => {
    const [result] = format([
      createTrace([
        createLog('execution-1-1'),
        { ...createLog('execution-1-2'), label: 'shell_run', data: { thought: '', tool: 'shell_run' } },
      ]),
    ])

    expect(result!.agentLog).toEqual([
      expect.objectContaining({
        message_id: 'execution-1-1',
        label: 'execution-1-1',
      }),
      expect.objectContaining({
        message_id: 'execution-1-2',
        label: 'shell_run',
        data: { thought: '', tool: 'shell_run' },
      }),
    ])
  })

  it('should ignore a non-array agent_log written before process entries existed', () => {
    const [result] = format([
      createNodeTracing({
        node_id: 'agent-node',
        node_type: BlockEnum.Agent,
        execution_metadata: {
          total_tokens: 0,
          total_price: 0,
          currency: 'USD',
          agent_log: { agent_backend: { run_id: 'run-1' } },
        },
      }),
    ])

    expect(result!.agentLog).toEqual([])
  })
})
