import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { updateEnvironmentVariables } from './workflow'

const mockPost = vi.hoisted(() => vi.fn())

vi.mock('./base', () => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    apps: { byAppId: { workflows: { draft: { environmentVariables: { post: mockPost } } } } },
  },
}))

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

    expect(mockPost).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      body: {
        environment_variables: environmentVariables,
        patch: true,
        deleted_environment_variable_ids: ['env-2'],
      },
    })
  })
})
