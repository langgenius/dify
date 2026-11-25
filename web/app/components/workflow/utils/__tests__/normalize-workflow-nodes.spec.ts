import { BlockEnum } from '../../types'
import { normalizeWorkflowNodes } from '../normalize-workflow-nodes'

const agent = (data: Record<string, unknown> = {}) => ({
  id: 'agent',
  data: { type: BlockEnum.Agent, agent_node_kind: 'dify_agent', version: '2', ...data },
})

describe('normalizeWorkflowNodes', () => {
  it('serializes the default on state when a Chatflow node has no saved setting', () => {
    const [node] = normalizeWorkflowNodes([agent()], 'advanced-chat')
    expect(node?.data).toHaveProperty('continue_agent_session', true)
  })

  it('preserves an explicit off state and the server-owned generation', () => {
    const original = agent({ continue_agent_session: false, agent_session_generation: '' })
    const [node] = normalizeWorkflowNodes([original], 'advanced-chat')
    expect(node?.data).toEqual(original.data)
  })

  it('only adds the default to New Agent nodes in Chatflow', () => {
    const legacyAgent = agent({ version: '1' })
    const currentAgent = agent()
    expect(normalizeWorkflowNodes([legacyAgent], 'advanced-chat')).toEqual([legacyAgent])
    expect(normalizeWorkflowNodes([currentAgent], 'workflow')).toEqual([currentAgent])
    expect(normalizeWorkflowNodes([currentAgent])).toEqual([currentAgent])
  })
})
