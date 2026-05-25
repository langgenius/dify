import { toast } from '@langgenius/dify-ui/toast'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useSnippetPublish } from '../use-snippet-publish'

const mockMutateAsync = vi.fn()
const mockSetPublishMenuOpen = vi.fn()
const mockUseKeyPress = vi.fn()
const mockSetPublishedAt = vi.fn()
const mockSetQueryData = vi.fn()
const mockHandleCheckBeforePublish = vi.fn<() => Promise<boolean>>()

let isPublishMenuOpen = false
let isPending = false
let shortcutHandler: ((event: KeyboardEvent) => void) | undefined

vi.mock('ahooks', () => ({
  useKeyPress: (...args: Parameters<typeof mockUseKeyPress>) => mockUseKeyPress(...args),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData: mockSetQueryData,
  }),
}))

vi.mock('@/service/use-snippet-workflows', () => ({
  usePublishSnippetWorkflowMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setPublishedAt: mockSetPublishedAt,
    }),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-checklist', () => ({
  useChecklistBeforePublish: () => ({
    handleCheckBeforePublish: mockHandleCheckBeforePublish,
  }),
}))

vi.mock('../../../store', () => ({
  useSnippetDetailStore: (selector: (state: {
    isPublishMenuOpen: boolean
    setPublishMenuOpen: typeof mockSetPublishMenuOpen
  }) => unknown) => selector({
    isPublishMenuOpen,
    setPublishMenuOpen: mockSetPublishMenuOpen,
  }),
}))

describe('useSnippetPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isPublishMenuOpen = false
    isPending = false
    shortcutHandler = undefined
    mockHandleCheckBeforePublish.mockResolvedValue(true)
    mockMutateAsync.mockResolvedValue({ created_at: 1_712_345_678 })
    mockUseKeyPress.mockImplementation((_key, handler) => {
      shortcutHandler = handler
    })
  })

  describe('Publish action', () => {
    it('should publish the snippet, close the menu, and show success feedback', async () => {
      const { result } = renderHook(() => useSnippetPublish({
        snippetId: 'snippet-1',
      }))

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(mockHandleCheckBeforePublish).toHaveBeenCalledTimes(1)
      expect(mockMutateAsync).toHaveBeenCalledWith({
        params: { snippetId: 'snippet-1' },
      })
      expect(mockSetQueryData).toHaveBeenCalledTimes(1)
      const setQueryDataCall = mockSetQueryData.mock.calls[0]
      expect(setQueryDataCall).toBeDefined()
      const updateSnippetDetail = setQueryDataCall![1] as (old: { is_published: boolean }) => { is_published: boolean }
      expect(updateSnippetDetail({ is_published: false })).toEqual({ is_published: true })
      expect(mockSetPublishedAt).toHaveBeenCalledWith(1_712_345_678)
      expect(mockSetPublishMenuOpen).toHaveBeenCalledWith(false)
      expect(toast.success).toHaveBeenCalledWith('snippet.publishSuccess')
    })

    it('should not publish the snippet when checklist validation fails', async () => {
      mockHandleCheckBeforePublish.mockResolvedValue(false)

      const { result } = renderHook(() => useSnippetPublish({
        snippetId: 'snippet-1',
      }))

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(mockHandleCheckBeforePublish).toHaveBeenCalledTimes(1)
      expect(mockMutateAsync).not.toHaveBeenCalled()
      expect(mockSetQueryData).not.toHaveBeenCalled()
      expect(mockSetPublishedAt).not.toHaveBeenCalled()
      expect(mockSetPublishMenuOpen).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should surface publish errors through toast feedback', async () => {
      mockMutateAsync.mockRejectedValue(new Error('publish failed'))

      const { result } = renderHook(() => useSnippetPublish({
        snippetId: 'snippet-1',
      }))

      await act(async () => {
        await result.current.handlePublish()
      })

      expect(toast.error).toHaveBeenCalledWith('publish failed')
      expect(mockSetPublishMenuOpen).not.toHaveBeenCalled()
    })
  })

  describe('Keyboard shortcut', () => {
    it('should trigger publish on ctrl+shift+p in the orchestrate section', async () => {
      renderHook(() => useSnippetPublish({
        snippetId: 'snippet-1',
      }))

      const event = new KeyboardEvent('keydown')
      const preventDefault = vi.spyOn(event, 'preventDefault')

      act(() => {
        shortcutHandler?.(event)
      })

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          params: { snippetId: 'snippet-1' },
        })
      })
      expect(preventDefault).toHaveBeenCalledTimes(1)
    })

    it('should ignore the shortcut while publishing is pending', () => {
      isPending = true
      renderHook(() => useSnippetPublish({
        snippetId: 'snippet-1',
      }))

      const event = new KeyboardEvent('keydown')
      const preventDefault = vi.spyOn(event, 'preventDefault')

      act(() => {
        shortcutHandler?.(event)
      })

      expect(mockMutateAsync).not.toHaveBeenCalled()
      expect(preventDefault).not.toHaveBeenCalled()
    })
  })
})
