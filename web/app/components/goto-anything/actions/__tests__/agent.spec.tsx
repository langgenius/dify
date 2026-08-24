import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { agentAction, agentSearchQueryOptions } from '../agent'

const serviceMocks = vi.hoisted(() => ({ queryOptions: vi.fn((options) => options) }))

vi.mock('@/service/client', () => ({
  consoleQuery: { agent: { get: { queryOptions: serviceMocks.queryOptions } } },
}))

vi.mock('../../../base/app-icon', () => ({ default: () => null }))

function agent(overrides: Partial<AgentAppPartial> = {}): AgentAppPartial {
  return {
    id: 'agent-1',
    name: 'Researcher',
    description: 'Investigates a topic',
    mode: 'agent-chat',
    icon_url: null,
    ...overrides,
  }
}

describe('agent search query', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes the @agents scope', () => {
    expect(agentAction).toMatchObject({ key: '@agents', shortcut: '@agents', source: 'remote' })
  })

  it('queries the generated agent endpoint by name', () => {
    agentSearchQueryOptions('research')

    expect(serviceMocks.queryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          query: {
            page: 1,
            limit: 10,
            name: 'research',
            sort_by: 'last_modified',
          },
        },
        retry: false,
        select: expect.any(Function),
      }),
    )
  })

  it('maps agents to their configure pages', () => {
    const options = agentSearchQueryOptions('research')
    const results = options.select!({
      data: [agent()] as never,
      has_more: false,
      limit: 10,
      page: 1,
      total: 1,
    })

    expect(results[0]).toMatchObject({
      id: 'agent-1',
      title: 'Researcher',
      description: 'Investigates a topic',
      type: 'agent',
      path: '/agents/agent-1/configure',
    })
  })
})
