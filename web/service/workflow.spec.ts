import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FlowType } from '@/types/common'
import { fetchAllInspectVars, updateEnvironmentVariables } from './workflow'

const mockGet = vi.hoisted(() => vi.fn())
const mockPost = vi.hoisted(() => vi.fn())

vi.mock('./base', () => ({
  get: mockGet,
  post: mockPost,
}))

vi.mock('./client', () => ({
  consoleClient: {},
}))

describe('fetchAllInspectVars', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps background variable preloading silent', async () => {
    mockGet.mockResolvedValue({ items: [], total: 0 })

    await fetchAllInspectVars(FlowType.appFlow, 'app-1')

    expect(mockGet).toHaveBeenCalledWith(
      'apps/app-1/workflows/draft/variables',
      { params: { page: 1, limit: 100 } },
      { silent: true },
    )
  })
})

describe('updateEnvironmentVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends per-ID upserts and deletions as a patch', async () => {
    const environmentVariables = [
      {
        id: 'env-1',
        name: 'for_summarize',
        description: '',
        value_type: 'llm',
        value: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4.1',
          mode: 'chat',
        },
      },
    ] satisfies EnvironmentVariable[]
    mockPost.mockResolvedValue({ result: 'success' })

    await updateEnvironmentVariables({
      appId: 'app-1',
      environmentVariables,
      deletedEnvironmentVariableIds: ['env-2'],
    })

    expect(mockPost).toHaveBeenCalledWith('apps/app-1/workflows/draft/environment-variables', {
      body: {
        environment_variables: environmentVariables,
        patch: true,
        deleted_environment_variable_ids: ['env-2'],
      },
    })
  })
})
