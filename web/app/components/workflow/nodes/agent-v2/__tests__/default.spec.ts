import type { AgentV2NodeType } from '../types'
import { BlockEnum } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import nodeDefault from '../default'
import { isAgentV2NodeData } from '../types'

const t = withSelectorKey(
  vi.fn((key: string, options?: Record<string, unknown>) => {
    if (key === 'errorMsg.fieldRequired') return `required:${options?.field}`

    if (key === 'nodes.agent.roster.label') return 'Agent'

    return key
  }),
  'workflow',
)

const createPayload = (overrides: Partial<AgentV2NodeType> = {}): AgentV2NodeType => ({
  title: 'Agent',
  desc: '',
  type: BlockEnum.AgentV2,
  agent_binding: {
    binding_type: 'roster_agent',
    agent_id: 'agent-1',
  },
  agent_node_kind: 'dify_agent',
  version: '2',
  ...overrides,
})

describe('agent/default', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires a roster agent id', () => {
    const result = nodeDefault.checkValid(
      createPayload({
        agent_binding: {
          binding_type: 'roster_agent',
          agent_id: '',
        },
      }),
      t,
    )

    expect(result).toEqual({
      isValid: false,
      errorMessage: 'required:Agent',
    })
  })

  it('requires a roster agent binding', () => {
    const result = nodeDefault.checkValid(createPayload({ agent_binding: undefined }), t)

    expect(result).toEqual({
      isValid: false,
      errorMessage: 'required:Agent',
    })
  })

  it('passes validation when a roster agent binding is selected', () => {
    const result = nodeDefault.checkValid(createPayload(), t)

    expect(result).toEqual({
      isValid: true,
      errorMessage: '',
    })
  })

  it('requires complete inline agent binding', () => {
    const result = nodeDefault.checkValid(
      createPayload({
        agent_binding: {
          binding_type: 'inline_agent',
        },
      }),
      t,
    )

    expect(result).toEqual({
      isValid: false,
      errorMessage: 'required:Agent',
    })
  })

  it('passes validation for complete inline agent binding', () => {
    const result = nodeDefault.checkValid(
      createPayload({
        agent_binding: {
          binding_type: 'inline_agent',
          agent_id: 'inline-agent-1',
          current_snapshot_id: 'inline-snapshot-1',
        },
      }),
      t,
    )

    expect(result).toEqual({
      isValid: true,
      errorMessage: '',
    })
  })

  it('creates Agent v2 graph data by default', () => {
    expect(nodeDefault.defaultValue).toMatchObject({
      agent_binding: {
        binding_type: 'inline_agent',
      },
      agent_node_kind: 'dify_agent',
      version: '2',
    })
  })

  it('reuses the legacy agent node help document', () => {
    expect(nodeDefault.metaData.helpLinkUri).toBe('agent')
  })

  it('identifies version 2 agent data as Agent v2', () => {
    expect(isAgentV2NodeData(createPayload({ type: BlockEnum.Agent }))).toBe(true)
    expect(
      isAgentV2NodeData({
        title: 'Agent',
        desc: '',
        type: BlockEnum.Agent,
        version: '2',
      } as Parameters<typeof isAgentV2NodeData>[0]),
    ).toBe(false)
  })
})
