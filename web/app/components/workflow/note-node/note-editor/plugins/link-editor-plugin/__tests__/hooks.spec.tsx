import { act, renderHook } from '@testing-library/react'
import { useLink, useOpenLink } from '../hooks'

const {
  mockDispatchCommand,
  mockRegisterUpdateListener,
  mockRegisterCommand,
  mockSetLinkAnchorElement,
  mockSetLinkOperatorShow,
  mockToastError,
  mockEditor,
  mockStoreState,
  mockListeners,
} = vi.hoisted(() => {
  const listeners: {
    update?: () => void
    click?: (payload: { metaKey?: boolean, ctrlKey?: boolean }) => boolean
  } = {}

  const editor = {
    dispatchCommand: vi.fn(),
    registerUpdateListener: vi.fn(),
    registerCommand: vi.fn(),
  }

  return {
    mockDispatchCommand: editor.dispatchCommand,
    mockRegisterUpdateListener: editor.registerUpdateListener,
    mockRegisterCommand: editor.registerCommand,
    mockSetLinkAnchorElement: vi.fn(),
    mockSetLinkOperatorShow: vi.fn(),
    mockToastError: vi.fn(),
    mockEditor: editor,
    mockStoreState: {
      selectedIsLink: false,
      selectedLinkUrl: '',
      setLinkAnchorElement: vi.fn(),
      setLinkOperatorShow: vi.fn(),
    },
    mockListeners: listeners,
  }
})

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => ([mockEditor]),
}))

vi.mock('@lexical/utils', () => ({
  mergeRegister: (...cleanups: Array<() => void>) => () => cleanups.forEach(cleanup => cleanup()),
}))

vi.mock('@lexical/link', () => ({
  TOGGLE_LINK_COMMAND: 'toggle-link-command',
}))

vi.mock('lexical', () => ({
  CLICK_COMMAND: 'click-command',
  COMMAND_PRIORITY_LOW: 1,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('../../../store', () => ({
  useNoteEditorStore: () => ({
    getState: () => mockStoreState,
  }),
}))

describe('link editor hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockStoreState.selectedIsLink = false
    mockStoreState.selectedLinkUrl = ''
    mockStoreState.setLinkAnchorElement = mockSetLinkAnchorElement
    mockStoreState.setLinkOperatorShow = mockSetLinkOperatorShow
    mockListeners.update = undefined
    mockListeners.click = undefined

    mockRegisterUpdateListener.mockImplementation((listener) => {
      mockListeners.update = listener
      return vi.fn()
    })
    mockRegisterCommand.mockImplementation((_command, listener) => {
      mockListeners.click = listener
      return vi.fn()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Link hover and click state should follow the selected link metadata in the editor store.
  describe('useOpenLink', () => {
    it('should show the link operator when the current selection is a link with a URL', () => {
      mockStoreState.selectedIsLink = true
      mockStoreState.selectedLinkUrl = 'https://dify.ai'

      renderHook(() => useOpenLink())

      act(() => {
        mockListeners.update?.()
        vi.runAllTimers()
      })

      expect(mockSetLinkAnchorElement).toHaveBeenCalledWith(true)
      expect(mockSetLinkOperatorShow).toHaveBeenCalledWith(true)
    })

    it('should clear the link operator when the current selection is not a link', () => {
      renderHook(() => useOpenLink())

      act(() => {
        mockListeners.update?.()
        vi.runAllTimers()
      })

      expect(mockSetLinkAnchorElement).toHaveBeenCalledWith()
      expect(mockSetLinkOperatorShow).toHaveBeenCalledWith(false)
    })

    it('should open the selected link in a new tab on meta or ctrl click', () => {
      mockStoreState.selectedIsLink = true
      mockStoreState.selectedLinkUrl = 'https://dify.ai'
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

      renderHook(() => useOpenLink())

      let handled = false
      act(() => {
        handled = mockListeners.click?.({ metaKey: true }) ?? false
        vi.runAllTimers()
      })

      expect(handled).toBe(false)
      expect(openSpy).toHaveBeenCalledWith('https://dify.ai', '_blank')
    })
  })

  // Saving and removing links should dispatch the lexical link command and close the operator.
  describe('useLink', () => {
    it('should reject invalid URLs and show an error toast', () => {
      const { result } = renderHook(() => useLink())

      act(() => {
        result.current.handleSaveLink('not-a-valid-url')
      })

      expect(mockToastError).toHaveBeenCalledWith('workflow.nodes.note.editor.invalidUrl')
      expect(mockDispatchCommand).not.toHaveBeenCalled()
    })

    it('should save a valid link and clear the anchor element', () => {
      const { result } = renderHook(() => useLink())

      act(() => {
        result.current.handleSaveLink('https://dify.ai/docs')
      })

      expect(mockDispatchCommand).toHaveBeenCalledWith('toggle-link-command', 'https://dify.ai/docs')
      expect(mockSetLinkAnchorElement).toHaveBeenCalledWith()
    })

    it('should remove the current link and clear the anchor element', () => {
      const { result } = renderHook(() => useLink())

      act(() => {
        result.current.handleUnlink()
      })

      expect(mockDispatchCommand).toHaveBeenCalledWith('toggle-link-command', null)
      expect(mockSetLinkAnchorElement).toHaveBeenCalledWith()
    })
  })
})
