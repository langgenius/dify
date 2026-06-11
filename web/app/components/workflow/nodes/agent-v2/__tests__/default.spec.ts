import type { AgentV2NodeType } from '../types'
import { BlockEnum } from '@/app/components/workflow/types'
import nodeDefault from '../default'
import { isAgentV2NodeData } from '../types'

const t = vi.fn((key: string, options?: Record<string, unknown>) => {
  if (key === 'errorMsg.fieldRequired')
    return `required:${options?.field}`

  if (key === 'nodes.agent.roster.label')
    return 'Agent'

  return key
})

const createPayload = (overrides: Partial<AgentV2NodeType> = {}): AgentV2NodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.AgentV2,
  agent_node_kind: 'dify_agent',
  agent_roster: {
    id: 'agent-1',
    name: 'Nadia',
    description: 'Clarification Drafter',
    icon: 'N',
    icon_background: '#E9D7FE',
    icon_type: 'emoji',
  },
  version: '2',
  ...overrides,
})

describe('agent/default', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires a selected roster agent', () => {
    const result = nodeDefault.checkValid(createPayload({ agent_roster: undefined }), t)

    expect(result).toEqual({
      isValid: false,
      errorMessage: 'required:Agent',
    })
  })

  it('passes validation when a roster agent is selected', () => {
    const result = nodeDefault.checkValid(createPayload(), t)

    expect(result).toEqual({
      isValid: true,
      errorMessage: '',
    })
  })

  it('creates Agent v2 graph data by default', () => {
    expect(nodeDefault.defaultValue).toMatchObject({
      agent_node_kind: 'dify_agent',
      version: '2',
    })
  })

  it('identifies only roster-backed version 2 agent data as Agent v2', () => {
    expect(isAgentV2NodeData(createPayload({ type: BlockEnum.Agent }))).toBe(true)
    expect(isAgentV2NodeData({
      title: 'Old Agent',
      desc: '',
      type: BlockEnum.Agent,
      version: '2',
    } as Parameters<typeof isAgentV2NodeData>[0])).toBe(false)
  })
})
