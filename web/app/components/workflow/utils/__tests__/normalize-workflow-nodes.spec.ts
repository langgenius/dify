import { BlockEnum } from '../../types'
import { normalizeWorkflowNodes } from '../normalize-workflow-nodes'

const agent = (
  data: Record<string, unknown> = {},
): { id: string; data: Record<string, unknown> } => ({
  id: 'agent',
  data: { type: BlockEnum.AgentV2, agent_node_kind: 'dify_agent', version: '2', ...data },
})

describe('normalizeWorkflowNodes', () => {
  it('sends the default Agent session mode explicitly in Chatflow', () => {
    const [node] = normalizeWorkflowNodes([agent()], 'advanced-chat')
    expect(node!.data.continue_agent_session).toBe(true)
  })

  it('keeps a chosen Agent session mode', () => {
    const [node] = normalizeWorkflowNodes(
      [agent({ continue_agent_session: false })],
      'advanced-chat',
    )
    expect(node!.data.continue_agent_session).toBe(false)
  })

  it('leaves Agent nodes outside Chatflow unchanged', () => {
    const [node] = normalizeWorkflowNodes([agent()], 'workflow')
    expect(node!.data).not.toHaveProperty('continue_agent_session')
  })
})
