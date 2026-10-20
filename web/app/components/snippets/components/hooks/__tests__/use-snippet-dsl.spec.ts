import { act } from 'react'
import { toast } from '@/app/notifications'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { downloadBlob } from '@/utils/download'
import { useSnippetDSL } from '../use-snippet-dsl'

const mockMutateAsync = vi.fn()

vi.mock('@/utils/download', () => ({
  downloadBlob: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.bySnippetId.export.get': (...args: unknown[]) =>
        mockMutateAsync(...args),
    }),
  }
})

describe('useSnippetDSL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockResolvedValue('kind: snippet')
  })

  it('exports the requested historical workflow version', async () => {
    const { result } = renderHook(() =>
      useSnippetDSL({ snippetId: 'snippet-1', snippetName: 'My Snippet' }),
    )

    await act(() => result.current.handleExportDSL(false, 'workflow-1'))

    expect(mockMutateAsync).toHaveBeenCalledWith({
      params: { snippet_id: 'snippet-1' },
      query: { include_secret: 'false', workflow_id: 'workflow-1' },
    })
    expect(downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'My Snippet.yml',
    })
    const file = vi.mocked(downloadBlob).mock.lastCall![0].data
    expect(file.type).toBe('application/yaml')
    expect(await file.text()).toBe('kind: snippet')
  })

  it('shows an error when exporting fails', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('failed'))
    const { result } = renderHook(() =>
      useSnippetDSL({ snippetId: 'snippet-1', snippetName: 'My Snippet' }),
    )

    await act(() => result.current.handleExportDSL(false, 'workflow-1'))

    expect(toast.error).toHaveBeenCalledWith('snippet.exportFailed')
    expect(downloadBlob).not.toHaveBeenCalled()
  })
})
