import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { updateEnvironmentVariables } from './workflow'

const mockFetch = vi.fn<typeof fetch>()
const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', () => ({ toast: { error: mockToastError } }))

describe('updateEnvironmentVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
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
    mockFetch.mockResolvedValue(Response.json({ result: 'success' }))

    await updateEnvironmentVariables({
      appId: 'app-1',
      environmentVariables,
      deletedEnvironmentVariableIds: ['env-2'],
    })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [input, init] = mockFetch.mock.calls[0]!
    const request = new Request(input, init)
    expect(request.url).toContain('/apps/app-1/workflows/draft/environment-variables')
    expect(await request.json()).toEqual({
      environment_variables: environmentVariables,
      patch: true,
      deleted_environment_variable_ids: ['env-2'],
    })
  })
  it('leaves HTTP failure feedback to the environment recovery owner', async () => {
    mockFetch.mockResolvedValue(
      Response.json({ message: 'Temporarily unavailable' }, { status: 503 }),
    )
    await expect(
      updateEnvironmentVariables({
        appId: 'app-1',
        environmentVariables: [],
        deletedEnvironmentVariableIds: [],
      }),
    ).rejects.toMatchObject({ defined: false, status: 503 })
    expect(mockToastError).not.toHaveBeenCalled()
  })
})
