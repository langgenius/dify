import type { NodeApi } from 'react-arborist'
import type { TreeNodeData } from '../../../type'
import { act, renderHook } from '@testing-library/react'
import { useTreeNodeHandlers } from './use-tree-node-handlers'

const {
  mockClearArtifactSelection,
  mockOpenTab,
  mockSetContextMenu,
} = vi.hoisted(() => ({
  mockClearArtifactSelection: vi.fn(),
  mockOpenTab: vi.fn(),
  mockSetContextMenu: vi.fn(),
}))

vi.mock('es-toolkit/function', () => ({
  throttle: (fn: () => void) => fn,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      clearArtifactSelection: mockClearArtifactSelection,
      openTab: mockOpenTab,
      setContextMenu: mockSetContextMenu,
    }),
  }),
}))

const createNode = (params: {
  id?: string
  nodeType: 'file' | 'folder'
}) => {
  const id = params.id ?? 'node-1'
  return {
    data: {
      id,
      node_type: params.nodeType,
      name: params.nodeType === 'folder' ? 'folder-a' : 'README.md',
      path: `/${id}`,
      extension: params.nodeType === 'folder' ? '' : 'md',
      size: 1,
      children: [],
    },
    toggle: vi.fn(),
    select: vi.fn(),
    selectMulti: vi.fn(),
    selectContiguous: vi.fn(),
    isOpen: false,
  } as unknown as NodeApi<TreeNodeData>
}

const createMouseEvent = (params: {
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  clientX?: number
  clientY?: number
} = {}) => {
  return {
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    shiftKey: params.shiftKey ?? false,
    ctrlKey: params.ctrlKey ?? false,
    metaKey: params.metaKey ?? false,
    clientX: params.clientX ?? 0,
    clientY: params.clientY ?? 0,
  } as unknown as React.MouseEvent
}

const createKeyboardEvent = (key: string) => {
  return {
    key,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent
}

describe('useTreeNodeHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Scenario: click behavior differs for folders/files and modifier keys.
  describe('handleClick', () => {
    it('should select contiguous node and toggle folder on shift-click', () => {
      const node = createNode({ nodeType: 'folder' })
      const { result } = renderHook(() => useTreeNodeHandlers({ node }))
      const event = createMouseEvent({ shiftKey: true })

      act(() => {
        result.current.handleClick(event)
      })

      expect(event.stopPropagation).toHaveBeenCalledTimes(1)
      expect(node.selectContiguous).toHaveBeenCalledTimes(1)
      expect(node.toggle).toHaveBeenCalledTimes(1)
      expect(node.select).not.toHaveBeenCalled()
      expect(node.selectMulti).not.toHaveBeenCalled()
    })

    it('should open file preview tab on plain click after delayed click timeout', () => {
      const node = createNode({ id: 'file-1', nodeType: 'file' })
      const { result } = renderHook(() => useTreeNodeHandlers({ node }))
      const event = createMouseEvent()

      act(() => {
        result.current.handleClick(event)
      })

      expect(node.select).toHaveBeenCalledTimes(1)
      expect(mockOpenTab).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(200)
      })

      expect(mockClearArtifactSelection).toHaveBeenCalledTimes(1)
      expect(mockOpenTab).toHaveBeenCalledWith('file-1', { pinned: false })
    })

    it('should not trigger file preview tab on ctrl-click', () => {
      const node = createNode({ id: 'file-2', nodeType: 'file' })
      const { result } = renderHook(() => useTreeNodeHandlers({ node }))
      const event = createMouseEvent({ ctrlKey: true })

      act(() => {
        result.current.handleClick(event)
        vi.advanceTimersByTime(250)
      })

      expect(node.selectMulti).toHaveBeenCalledTimes(1)
      expect(mockOpenTab).not.toHaveBeenCalled()
      expect(mockClearArtifactSelection).not.toHaveBeenCalled()
    })
  })

  // Scenario: double-click and toggle handlers route to folder toggle or pinned file open.
  describe('double click and toggle', () => {
    it('should toggle folder on double click', () => {
      const node = createNode({ nodeType: 'folder' })
      const { result } = renderHook(() => useTreeNodeHandlers({ node }))
      const event = createMouseEvent()

      act(() => {
        result.current.handleDoubleClick(event)
      })

      expect(event.stopPropagation).toHaveBeenCalledTimes(1)
      expect(node.toggle).toHaveBeenCalledTimes(1)
      expect(mockOpenTab).not.toHaveBeenCalled()
    })

    it('should open file as pinned tab on double click', () => {
      const node = createNode({ id: 'file-3', nodeType: 'file' })
      const { result } = renderHook(() => useTreeNodeHandlers({ node }))
      const event = createMouseEvent()

      act(() => {
        result.current.handleDoubleClick(event)
      })

      expect(event.stopPropagation).toHaveBeenCalledTimes(1)
      expect(mockClearArtifactSelection).toHaveBeenCalledTimes(1)
      expect(mockOpenTab).toHaveBeenCalledWith('file-3', { pinned: true })
    })

    it('should toggle node when toggle handler is invoked', () => {
      const node = createNode({ nodeType: 'folder' })
      const { result } = renderHook(() => useTreeNodeHandlers({ node }))
      const event = createMouseEvent()

      act(() => {
        result.current.handleToggle(event)
      })

      expect(event.stopPropagation).toHaveBeenCalledTimes(1)
      expect(node.toggle).toHaveBeenCalledTimes(1)
    })
  })

  // Scenario: context menu and keyboard handlers update menu state and open/toggle actions.
  describe('context menu and keyboard', () => {
    it('should select node and set context menu payload on right click', () => {
      const node = createNode({ id: 'folder-1', nodeType: 'folder' })
      const { result } = renderHook(() => useTreeNodeHandlers({ node }))
      const event = createMouseEvent({ clientX: 120, clientY: 45 })

      act(() => {
        result.current.handleContextMenu(event)
      })

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(event.stopPropagation).toHaveBeenCalledTimes(1)
      expect(node.select).toHaveBeenCalledTimes(1)
      expect(mockSetContextMenu).toHaveBeenCalledWith({
        top: 45,
        left: 120,
        type: 'node',
        nodeId: 'folder-1',
        isFolder: true,
      })
    })

    it('should toggle folder on Enter key', () => {
      const node = createNode({ nodeType: 'folder' })
      const { result } = renderHook(() => useTreeNodeHandlers({ node }))
      const event = createKeyboardEvent('Enter')

      act(() => {
        result.current.handleKeyDown(event)
      })

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(node.toggle).toHaveBeenCalledTimes(1)
      expect(mockOpenTab).not.toHaveBeenCalled()
    })

    it('should open file as pinned tab on Space key', () => {
      const node = createNode({ id: 'file-4', nodeType: 'file' })
      const { result } = renderHook(() => useTreeNodeHandlers({ node }))
      const event = createKeyboardEvent(' ')

      act(() => {
        result.current.handleKeyDown(event)
      })

      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(mockClearArtifactSelection).toHaveBeenCalledTimes(1)
      expect(mockOpenTab).toHaveBeenCalledWith('file-4', { pinned: true })
    })
  })
})
