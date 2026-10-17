import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import { zAgentAppPartial } from '@dify/contracts/api/console/agent/zod.gen'
import { agentSearchQueryOptions } from '../agent'

const serviceMocks = vi.hoisted(() => ({ queryOptions: vi.fn((options) => options) }))

vi.mock('@/service/console', () => ({
  consoleQuery: { agent: { get: { queryOptions: serviceMocks.queryOptions } } },
}))

function agent(overrides: Partial<AgentAppPartial> = {}) {
  return zAgentAppPartial.parse({
    id: 'agent-1',
    name: 'Researcher',
    description: 'Investigates a topic',
    mode: 'agent-chat',
    icon_url: null,
    permission_keys: [],
    ...overrides,
  })
}

describe('agent search query', () => {
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
      data: [agent()],
      has_more: false,
      limit: 10,
      page: 1,
      publication_counts: { drafts: 0, published: 1 },
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
