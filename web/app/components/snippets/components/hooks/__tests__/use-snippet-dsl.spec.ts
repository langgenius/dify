import { toast } from '@langgenius/dify-ui/toast'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { useExportSnippetMutation } from '@/service/use-snippets'
import { downloadBlob } from '@/utils/download'
import { useSnippetDSL } from '../use-snippet-dsl'

const mockMutateAsync = vi.fn()

vi.mock('@/service/use-snippets', () => ({
  useExportSnippetMutation: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
  })),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

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

    expect(useExportSnippetMutation).toHaveBeenCalled()
    expect(mockMutateAsync).toHaveBeenCalledWith({
      snippetId: 'snippet-1',
      include: false,
      workflowId: 'workflow-1',
    })
    expect(downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'My Snippet.yml',
    })
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
