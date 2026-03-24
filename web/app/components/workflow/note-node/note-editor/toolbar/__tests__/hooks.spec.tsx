import { renderHook } from '@testing-library/react'
import { useCommand, useFontSize } from '../hooks'

type MockSelectionParent = { isLink: boolean } | null

const {
  mockDispatchCommand,
  mockEditorUpdate,
  mockRegisterUpdateListener,
  mockRegisterCommand,
  mockRead,
  mockSetLinkAnchorElement,
  mockSelectionNode,
  mockSelection,
  mockPatchStyleText,
  mockSetSelection,
  mockSelectionFontSize,
  mockIsRangeSelection,
  mockSelectedIsBullet,
  mockSetBlocksType,
} = vi.hoisted(() => ({
  mockDispatchCommand: vi.fn(),
  mockEditorUpdate: vi.fn(),
  mockRegisterUpdateListener: vi.fn(),
  mockRegisterCommand: vi.fn(),
  mockRead: vi.fn(),
  mockSetLinkAnchorElement: vi.fn(),
  mockSelectionNode: {
    getParent: vi.fn<() => MockSelectionParent>(() => null),
  },
  mockSelection: {
    anchor: {
      getNode: vi.fn(),
    },
    focus: {
      getNode: vi.fn(),
    },
    isBackward: vi.fn(() => false),
    clone: vi.fn(() => 'cloned-selection'),
  },
  mockPatchStyleText: vi.fn(),
  mockSetSelection: vi.fn(),
  mockSelectionFontSize: vi.fn(),
  mockIsRangeSelection: vi.fn(() => true),
  mockSelectedIsBullet: vi.fn(() => false),
  mockSetBlocksType: vi.fn(),
}))

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => ([{
    dispatchCommand: mockDispatchCommand,
    update: mockEditorUpdate,
    registerUpdateListener: mockRegisterUpdateListener,
    registerCommand: mockRegisterCommand,
    getEditorState: () => ({
      read: mockRead,
    }),
  }]),
}))

vi.mock('@lexical/link', () => ({
  $isLinkNode: (node: unknown) => Boolean(node && typeof node === 'object' && 'isLink' in (node as object)),
  TOGGLE_LINK_COMMAND: 'toggle-link-command',
}))

vi.mock('@lexical/list', () => ({
  INSERT_UNORDERED_LIST_COMMAND: 'insert-unordered-list-command',
}))

vi.mock('@lexical/selection', () => ({
  $getSelectionStyleValueForProperty: () => mockSelectionFontSize(),
  $isAtNodeEnd: () => false,
  $patchStyleText: mockPatchStyleText,
  $setBlocksType: mockSetBlocksType,
}))

vi.mock('@lexical/utils', () => ({
  mergeRegister: (...cleanups: Array<() => void>) => () => cleanups.forEach(cleanup => cleanup()),
}))

vi.mock('lexical', () => ({
  $createParagraphNode: () => ({ type: 'paragraph' }),
  $getSelection: () => mockSelection,
  $isRangeSelection: () => mockIsRangeSelection(),
  $setSelection: mockSetSelection,
  COMMAND_PRIORITY_CRITICAL: 4,
  FORMAT_TEXT_COMMAND: 'format-text-command',
  SELECTION_CHANGE_COMMAND: 'selection-change-command',
}))

vi.mock('../../store', () => ({
  useNoteEditorStore: () => ({
    getState: () => ({
      selectedIsBullet: mockSelectedIsBullet(),
      setLinkAnchorElement: mockSetLinkAnchorElement,
    }),
  }),
}))

describe('note toolbar hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEditorUpdate.mockImplementation((callback) => {
      callback()
    })
    mockRegisterUpdateListener.mockImplementation((listener) => {
      listener({})
      return vi.fn()
    })
    mockRegisterCommand.mockImplementation((_command, listener) => {
      listener()
      return vi.fn()
    })
    mockRead.mockImplementation((callback) => {
      callback()
    })
    mockSelectionFontSize.mockReturnValue('16px')
    mockIsRangeSelection.mockReturnValue(true)
    mockSelectedIsBullet.mockReturnValue(false)
    mockSelection.anchor.getNode.mockReturnValue(mockSelectionNode)
    mockSelection.focus.getNode.mockReturnValue(mockSelectionNode)
    mockSelectionNode.getParent.mockReturnValue(null)
  })

  describe('useCommand', () => {
    it('should dispatch text formatting commands directly', () => {
      const { result } = renderHook(() => useCommand())

      result.current.handleCommand('bold')
      result.current.handleCommand('italic')
      result.current.handleCommand('strikethrough')

      expect(mockDispatchCommand).toHaveBeenNthCalledWith(1, 'format-text-command', 'bold')
      expect(mockDispatchCommand).toHaveBeenNthCalledWith(2, 'format-text-command', 'italic')
      expect(mockDispatchCommand).toHaveBeenNthCalledWith(3, 'format-text-command', 'strikethrough')
    })

    it('should open link editing when current selection is not already a link', () => {
      const { result } = renderHook(() => useCommand())

      result.current.handleCommand('link')

      expect(mockDispatchCommand).toHaveBeenCalledWith('toggle-link-command', '')
      expect(mockSetLinkAnchorElement).toHaveBeenCalledWith(true)
    })

    it('should remove the link when the current selection is already within a link node', () => {
      mockSelectionNode.getParent.mockReturnValue({ isLink: true })
      const { result } = renderHook(() => useCommand())

      result.current.handleCommand('link')

      expect(mockDispatchCommand).toHaveBeenCalledWith('toggle-link-command', null)
      expect(mockSetLinkAnchorElement).toHaveBeenCalledWith()
    })

    it('should ignore link commands when the selection is not a range', () => {
      mockIsRangeSelection.mockReturnValue(false)
      const { result } = renderHook(() => useCommand())

      result.current.handleCommand('link')

      expect(mockDispatchCommand).not.toHaveBeenCalled()
      expect(mockSetLinkAnchorElement).not.toHaveBeenCalled()
    })

    it('should toggle bullet formatting on and off', () => {
      const { result, rerender } = renderHook(() => useCommand())

      result.current.handleCommand('bullet')
      expect(mockDispatchCommand).toHaveBeenCalledWith('insert-unordered-list-command', undefined)

      mockSelectedIsBullet.mockReturnValue(true)
      rerender()

      result.current.handleCommand('bullet')
      expect(mockSetBlocksType).toHaveBeenCalledWith(mockSelection, expect.any(Function))
    })
  })

  describe('useFontSize', () => {
    it('should expose font size state and update selection styling', () => {
      const { result } = renderHook(() => useFontSize())

      expect(result.current.fontSize).toBe('16px')

      result.current.handleFontSize('20px')
      expect(mockPatchStyleText).toHaveBeenCalledWith(mockSelection, { 'font-size': '20px' })
    })

    it('should preserve the current selection when opening the selector', () => {
      const { result } = renderHook(() => useFontSize())

      result.current.handleOpenFontSizeSelector(true)

      expect(mockSetSelection).toHaveBeenCalledWith('cloned-selection')
    })

    it('should keep the default font size and avoid patching styles when the selection is not a range', () => {
      mockIsRangeSelection.mockReturnValue(false)
      const { result } = renderHook(() => useFontSize())

      expect(result.current.fontSize).toBe('12px')

      result.current.handleFontSize('20px')
      expect(mockPatchStyleText).not.toHaveBeenCalled()
    })
  })
})
