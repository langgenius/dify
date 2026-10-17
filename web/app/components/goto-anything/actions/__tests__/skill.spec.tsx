import type { SkillResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { zSkillResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { skillSearchQueryOptions } from '../skill'

const serviceMocks = vi.hoisted(() => ({ queryOptions: vi.fn((options) => options) }))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    workspaces: { current: { skills: { get: { queryOptions: serviceMocks.queryOptions } } } },
  },
}))

function skill(overrides: Partial<SkillResponse> = {}) {
  return zSkillResponse.parse({
    id: 'skill-1',
    name: 'summarizer',
    display_name: 'Summarizer',
    description: 'Summarizes long documents',
    icon: '',
    visibility: 'private',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  })
}

describe('skill search query', () => {
  it('queries the generated skill endpoint by keyword', () => {
    skillSearchQueryOptions('summary')

    expect(serviceMocks.queryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { query: { page: 1, limit: 10, keyword: 'summary' } },
        retry: false,
        select: expect.any(Function),
      }),
    )
  })

  it('maps skills to their detail pages', () => {
    const options = skillSearchQueryOptions('summary')
    const results = options.select!({
      data: [skill()],
      page: 1,
      limit: 10,
      total: 1,
      has_more: false,
    })

    expect(results[0]).toMatchObject({
      id: 'skill-1',
      title: 'Summarizer',
      description: 'Summarizes long documents',
      type: 'skill',
      path: '/skills/skill-1',
    })
  })
})
