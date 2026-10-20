import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vite-plus/test'
import { useExportSnippetMutation } from '../use-snippets'

const mockExportSnippet = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const workspace = actual.consoleClient.workspaces.current
  const snippets = workspace.customizedSnippets
  return {
    ...actual,
    consoleClient: {
      ...actual.consoleClient,
      workspaces: {
        ...actual.consoleClient.workspaces,
        current: {
          ...workspace,
          customizedSnippets: {
            ...snippets,
            bySnippetId: {
              ...snippets.bySnippetId,
              export: { ...snippets.bySnippetId.export, get: mockExportSnippet },
            },
          },
        },
      },
    },
  }
})

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })

  onTestFinished(() => queryClient.clear())

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useExportSnippetMutation', () => {
  beforeEach(() => {
    mockExportSnippet.mockReset().mockResolvedValue('kind: snippet')
  })

  it('exports the requested historical workflow version', async () => {
    const { result } = renderHook(() => useExportSnippetMutation(), { wrapper: createWrapper() })

    await act(async () => {
      const exported = await result.current.mutateAsync({
        snippetId: 'snippet-1',
        workflowId: 'workflow-1',
      })
      expect(exported).toBe('kind: snippet')
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
