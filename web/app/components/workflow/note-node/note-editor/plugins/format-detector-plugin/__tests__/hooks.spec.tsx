import { act, renderHook } from '@testing-library/react'
import { useFormatDetector } from '../hooks'

type MockParent = {
  isLink?: boolean
  getURL?: () => string
  isListItem?: boolean
} | null

const {
  mockRegisterUpdateListener,
  mockSelection,
  mockIsRangeSelection,
  mockSelectedNode,
  mockSetSelectedIsBold,
  mockSetSelectedIsItalic,
  mockSetSelectedIsStrikeThrough,
  mockSetSelectedLinkUrl,
  mockSetSelectedIsLink,
  mockSetSelectedIsBullet,
  mockEditorIsComposing,
  mockUpdateListener,
} = vi.hoisted(() => ({
  mockRegisterUpdateListener: vi.fn(),
  mockSelection: {
    hasFormat: vi.fn((format: string) => format === 'bold'),
  },
  mockIsRangeSelection: vi.fn(() => true),
  mockSelectedNode: {
    isLink: false,
    isListItem: false,
    getURL: vi.fn(() => ''),
    getParent: vi.fn<() => MockParent>(() => null),
  },
  mockSetSelectedIsBold: vi.fn(),
  mockSetSelectedIsItalic: vi.fn(),
  mockSetSelectedIsStrikeThrough: vi.fn(),
  mockSetSelectedLinkUrl: vi.fn(),
  mockSetSelectedIsLink: vi.fn(),
  mockSetSelectedIsBullet: vi.fn(),
  mockEditorIsComposing: vi.fn(() => false),
  mockUpdateListener: { current: undefined as undefined | (() => void) },
}))

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => ([{
    isComposing: mockEditorIsComposing,
    getEditorState: () => ({
      read: (callback: () => void) => callback(),
    }),
    registerUpdateListener: mockRegisterUpdateListener,
  }]),
}))

vi.mock('@lexical/utils', () => ({
  mergeRegister: (...cleanups: Array<() => void>) => () => cleanups.forEach(cleanup => cleanup()),
}))

vi.mock('@lexical/link', () => ({
  $isLinkNode: (node: unknown) => Boolean(node && typeof node === 'object' && 'isLink' in (node as object) && (node as { isLink?: boolean }).isLink),
}))

vi.mock('@lexical/list', () => ({
  $isListItemNode: (node: unknown) => Boolean(node && typeof node === 'object' && 'isListItem' in (node as object) && (node as { isListItem?: boolean }).isListItem),
}))

vi.mock('lexical', () => ({
  $getSelection: () => mockSelection,
  $isRangeSelection: () => mockIsRangeSelection(),
}))

vi.mock('../../../store', () => ({
  useNoteEditorStore: () => ({
    getState: () => ({
      setSelectedIsBold: mockSetSelectedIsBold,
      setSelectedIsItalic: mockSetSelectedIsItalic,
      setSelectedIsStrikeThrough: mockSetSelectedIsStrikeThrough,
      setSelectedLinkUrl: mockSetSelectedLinkUrl,
      setSelectedIsLink: mockSetSelectedIsLink,
      setSelectedIsBullet: mockSetSelectedIsBullet,
    }),
  }),
}))

vi.mock('../../../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils')>()
  return {
    ...actual,
    getSelectedNode: () => mockSelectedNode,
  }
})

describe('format detector hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRangeSelection.mockReturnValue(true)
    mockEditorIsComposing.mockReturnValue(false)
    mockSelection.hasFormat.mockImplementation((format: string) => format === 'bold' || format === 'strikethrough')
    mockSelectedNode.isLink = false
    mockSelectedNode.isListItem = false
    mockSelectedNode.getURL.mockReturnValue('')
    mockSelectedNode.getParent.mockReturnValue(null)
    mockRegisterUpdateListener.mockImplementation((listener) => {
      mockUpdateListener.current = () => listener({})
      return vi.fn()
    })
  })

  // Selection updates should mirror formatting, link, and list state into the note editor store.
  describe('Formatting Detection', () => {
    it('should sync bold, italic, strikethrough, link, and bullet state from the current selection', () => {
      mockSelectedNode.isLink = true
      mockSelectedNode.getURL.mockReturnValue('https://dify.ai')
      mockSelectedNode.getParent.mockReturnValue({ isListItem: true })

      const { result } = renderHook(() => useFormatDetector())

      act(() => {
        result.current.handleFormat()
      })

      expect(mockSetSelectedIsBold).toHaveBeenCalledWith(true)
      expect(mockSetSelectedIsItalic).toHaveBeenCalledWith(false)
      expect(mockSetSelectedIsStrikeThrough).toHaveBeenCalledWith(true)
      expect(mockSetSelectedLinkUrl).toHaveBeenCalledWith('https://dify.ai')
      expect(mockSetSelectedIsLink).toHaveBeenCalledWith(true)
      expect(mockSetSelectedIsBullet).toHaveBeenCalledWith(true)
    })

    it('should clear link and bullet state for a plain text selection triggered by selectionchange', () => {
      const addListenerSpy = vi.spyOn(document, 'addEventListener')
      const removeListenerSpy = vi.spyOn(document, 'removeEventListener')
      const { unmount } = renderHook(() => useFormatDetector())

      act(() => {
        document.dispatchEvent(new Event('selectionchange'))
      })

      expect(addListenerSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function))
      expect(mockSetSelectedLinkUrl).toHaveBeenCalledWith('')
      expect(mockSetSelectedIsLink).toHaveBeenCalledWith(false)
      expect(mockSetSelectedIsBullet).toHaveBeenCalledWith(false)

      unmount()

      expect(removeListenerSpy).toHaveBeenCalledWith('selectionchange', expect.any(Function))
    })

    it('should ignore format detection while the editor is composing', () => {
      mockEditorIsComposing.mockReturnValue(true)
      const { result } = renderHook(() => useFormatDetector())

      act(() => {
        result.current.handleFormat()
      })

      expect(mockSetSelectedIsBold).not.toHaveBeenCalled()
      expect(mockSetSelectedLinkUrl).not.toHaveBeenCalled()
    })

    it('should react to lexical update events', () => {
      renderHook(() => useFormatDetector())

      act(() => {
        mockUpdateListener.current?.()
      })

      expect(mockSetSelectedIsBold).toHaveBeenCalledWith(true)
      expect(mockSetSelectedIsItalic).toHaveBeenCalledWith(false)
    })
  })
})
