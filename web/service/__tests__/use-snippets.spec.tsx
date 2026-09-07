import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useExportSnippetMutation } from '../use-snippets'

const mockExportSnippet = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleClient: {
    workspaces: {
      current: {
        customizedSnippets: {
          bySnippetId: {
            export: {
              get: mockExportSnippet,
            },
          },
        },
      },
    },
  },
  consoleQuery: {
    snippets: {
      key: vi.fn(() => ['snippets']),
    },
    workspaces: {
      current: {
        customizedSnippets: {
          key: vi.fn(() => ['customized-snippets']),
          bySnippetId: {
            export: {
              get: {
                mutationKey: vi.fn(() => ['customized-snippets', 'export']),
              },
            },
          },
        },
      },
    },
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useExportSnippetMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExportSnippet.mockResolvedValue('kind: snippet')
  })

  it('exports the requested historical workflow version', async () => {
    const { result } = renderHook(() => useExportSnippetMutation(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        snippetId: 'snippet-1',
        workflowId: 'workflow-1',
      })
    })

    expect(mockExportSnippet).toHaveBeenCalledWith({
      params: { snippet_id: 'snippet-1' },
      query: {
        include_secret: 'false',
        workflow_id: 'workflow-1',
      },
    })
  })
})
