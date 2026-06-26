import type { ReactNode } from 'react'
import type { SnippetWorkflow } from '@/types/snippet'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { get } from '../base'
import { useSnippetDraftWorkflow } from '../use-snippet-workflows'

const { draftWorkflowQueryOptions } = vi.hoisted(() => ({
  draftWorkflowQueryOptions: vi.fn(),
}))

vi.mock('../base', () => ({
  get: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    snippets: {
      draftWorkflow: {
        queryOptions: draftWorkflowQueryOptions,
      },
    },
  },
}))

const mockGet = vi.mocked(get)

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useSnippetDraftWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    draftWorkflowQueryOptions.mockReturnValue({
      queryKey: ['console', 'snippets', 'draft-workflow', 'snippet-1'],
      enabled: true,
      queryFn: vi.fn(),
    })
  })

  it('should fetch the draft workflow silently during initialization', async () => {
    const onSuccess = vi.fn()
    const draftWorkflow = {
      hash: 'draft-hash',
      updated_at: 1_712_345_678,
    } as SnippetWorkflow

    mockGet.mockResolvedValueOnce(draftWorkflow)

    const { result } = renderHook(() => useSnippetDraftWorkflow('snippet-1', onSuccess), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual(draftWorkflow)
    })

    expect(draftWorkflowQueryOptions).toHaveBeenCalledWith({
      input: {
        params: { snippetId: 'snippet-1' },
      },
      enabled: true,
    })
    expect(mockGet).toHaveBeenCalledWith('/snippets/snippet-1/workflows/draft', {}, { silent: true })
    expect(onSuccess).toHaveBeenCalledWith(draftWorkflow)
  })
})
