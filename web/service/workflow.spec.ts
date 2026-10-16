import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { updateEnvironmentVariables } from './workflow'

const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockRequest },
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
    mockRequest.mockResolvedValue({ result: 'success' })

    await updateEnvironmentVariables({
      appId: 'app-1',
      environmentVariables,
      deletedEnvironmentVariableIds: ['env-2'],
    })

    expect(mockRequest).toHaveBeenCalledWith(
      ['apps', 'byAppId', 'workflows', 'draft', 'environmentVariables', 'post'],
      {
        params: { app_id: 'app-1' },
        body: {
          environment_variables: environmentVariables,
          patch: true,
          deleted_environment_variable_ids: ['env-2'],
        },
      },
      expect.any(Object),
    )
  })
})
