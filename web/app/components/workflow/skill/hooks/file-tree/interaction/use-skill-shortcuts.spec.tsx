import type { RefObject } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../../type'
import { act, renderHook } from '@testing-library/react'
import { getKeyboardKeyCodeBySystem } from '@/app/components/workflow/utils/common'
import { useSkillShortcuts } from './use-skill-shortcuts'

const {
  mockUseKeyPress,
  mockCutNodes,
  mockHasClipboard,
  registeredShortcutHandlers,
} = vi.hoisted(() => ({
  mockUseKeyPress: vi.fn(),
  mockCutNodes: vi.fn(),
  mockHasClipboard: vi.fn(() => false),
  registeredShortcutHandlers: {} as Record<string, (event: KeyboardEvent) => void>,
}))

vi.mock('ahooks', () => ({
  useKeyPress: (hotkey: string, callback: (event: KeyboardEvent) => void) => {
    mockUseKeyPress(hotkey, callback)
    registeredShortcutHandlers[hotkey] = callback
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      cutNodes: mockCutNodes,
      hasClipboard: mockHasClipboard,
    }),
  }),
}))

const createTreeRef = (selectedIds: string[]): RefObject<TreeApi<TreeNodeData> | null> => {
  return {
    current: {
      selectedNodes: selectedIds.map(id => ({ id })),
    } as unknown as TreeApi<TreeNodeData>,
  }
}

const createShortcutEvent = (target: HTMLElement): KeyboardEvent => {
  return {
    target,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent
}

describe('useSkillShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(registeredShortcutHandlers).forEach((shortcut) => {
      delete registeredShortcutHandlers[shortcut]
    })
    mockHasClipboard.mockReturnValue(false)
  })

  // Scenario: register platform-aware cut and paste shortcuts on mount.
  describe('shortcut registration', () => {
    it('should register cut and paste key combinations', () => {
      const treeRef = createTreeRef([])
      renderHook(() => useSkillShortcuts({ treeRef }))

      const ctrlKey = getKeyboardKeyCodeBySystem('ctrl')
      expect(mockUseKeyPress).toHaveBeenCalledTimes(2)
      expect(registeredShortcutHandlers[`${ctrlKey}.x`]).toBeTypeOf('function')
      expect(registeredShortcutHandlers[`${ctrlKey}.v`]).toBeTypeOf('function')
    })
  })

  // Scenario: cut shortcut depends on target context, selection state, and enabled state.
  describe('cut shortcut', () => {
    it('should cut selected nodes when keyboard event originates in tree container', () => {
      const treeRef = createTreeRef(['file-1', 'file-2'])
      renderHook(() => useSkillShortcuts({ treeRef }))

      const container = document.createElement('div')
      container.setAttribute('data-skill-tree-container', '')
      const target = document.createElement('button')
      container.appendChild(target)
      const event = createShortcutEvent(target)

      const cutShortcut = `${getKeyboardKeyCodeBySystem('ctrl')}.x`
      act(() => {
        registeredShortcutHandlers[cutShortcut](event)
      })

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(mockCutNodes).toHaveBeenCalledWith(['file-1', 'file-2'])
    })

    it('should cut selected nodes even when event target is outside tree container', () => {
      const treeRef = createTreeRef(['file-3'])
      renderHook(() => useSkillShortcuts({ treeRef }))

      const outsideTarget = document.createElement('button')
      const event = createShortcutEvent(outsideTarget)

      const cutShortcut = `${getKeyboardKeyCodeBySystem('ctrl')}.x`
      act(() => {
        registeredShortcutHandlers[cutShortcut](event)
      })

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(mockCutNodes).toHaveBeenCalledWith(['file-3'])
    })

    it('should ignore cut shortcut when target is an input area', () => {
      const treeRef = createTreeRef(['file-1'])
      renderHook(() => useSkillShortcuts({ treeRef }))

      const input = document.createElement('input')
      const event = createShortcutEvent(input)

      const cutShortcut = `${getKeyboardKeyCodeBySystem('ctrl')}.x`
      act(() => {
        registeredShortcutHandlers[cutShortcut](event)
      })

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(mockCutNodes).not.toHaveBeenCalled()
    })

    it('should ignore cut shortcut when shortcuts are disabled', () => {
      const treeRef = createTreeRef(['file-1'])
      const { rerender } = renderHook(
        ({ enabled }) => useSkillShortcuts({ treeRef, enabled }),
        { initialProps: { enabled: true } },
      )

      rerender({ enabled: false })

      const container = document.createElement('div')
      container.setAttribute('data-skill-tree-container', '')
      const target = document.createElement('button')
      container.appendChild(target)
      const event = createShortcutEvent(target)

      const cutShortcut = `${getKeyboardKeyCodeBySystem('ctrl')}.x`
      act(() => {
        registeredShortcutHandlers[cutShortcut](event)
      })

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(mockCutNodes).not.toHaveBeenCalled()
    })
  })

  // Scenario: paste shortcut dispatches global paste event only when clipboard has content.
  describe('paste shortcut', () => {
    it('should dispatch paste event when clipboard has content and shortcut should be handled', () => {
      mockHasClipboard.mockReturnValue(true)
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
      const treeRef = createTreeRef(['file-1'])
      renderHook(() => useSkillShortcuts({ treeRef }))

      const target = document.createElement('button')
      const event = createShortcutEvent(target)

      const pasteShortcut = `${getKeyboardKeyCodeBySystem('ctrl')}.v`
      act(() => {
        registeredShortcutHandlers[pasteShortcut](event)
      })

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(dispatchEventSpy).toHaveBeenCalledTimes(1)
      expect(dispatchEventSpy.mock.calls[0][0].type).toBe('skill:paste')
    })

    it('should ignore paste shortcut when clipboard is empty', () => {
      mockHasClipboard.mockReturnValue(false)
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
      const treeRef = createTreeRef(['file-1'])
      renderHook(() => useSkillShortcuts({ treeRef }))

      const target = document.createElement('button')
      const event = createShortcutEvent(target)

      const pasteShortcut = `${getKeyboardKeyCodeBySystem('ctrl')}.v`
      act(() => {
        registeredShortcutHandlers[pasteShortcut](event)
      })

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(dispatchEventSpy).not.toHaveBeenCalled()
    })
  })
})
