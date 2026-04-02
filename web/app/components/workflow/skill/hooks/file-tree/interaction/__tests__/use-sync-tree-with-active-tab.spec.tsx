import type { ReactNode, RefObject } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../../../type'
import { renderHook } from '@testing-library/react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { START_TAB_ID } from '../../../../constants'
import { useSyncTreeWithActiveTab } from '.././use-sync-tree-with-active-tab'

type MockTreeNode = {
  id: string
  isRoot: boolean
  parent: MockTreeNode | null
  isOpen?: boolean
  isSelected?: boolean
  isFocused?: boolean
}

const createWrapper = (store: ReturnType<typeof createWorkflowStore>) => {
  return ({ children }: { children: ReactNode }) => (
    <WorkflowContext value={store}>
      {children}
    </WorkflowContext>
  )
}

const createTreeRef = (tree: unknown): RefObject<TreeApi<TreeNodeData> | null> => {
  return { current: tree as TreeApi<TreeNodeData> }
}

describe('useSyncTreeWithActiveTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  it('should skip syncing when there is no active tab', () => {
    const store = createWorkflowStore({})
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame')
    const treeRef = createTreeRef({
      selectedNodes: [],
      deselectAll: vi.fn(),
      get: vi.fn(),
      openParents: vi.fn(),
      select: vi.fn(),
    })

    renderHook(() => useSyncTreeWithActiveTab({
      treeRef,
      activeTabId: null,
      isTreeLoading: false,
    }), { wrapper: createWrapper(store) })

    expect(requestAnimationFrameSpy).not.toHaveBeenCalled()
  })

  it('should skip syncing while the tree is still loading', () => {
    const store = createWorkflowStore({})
    const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame')
    const treeRef = createTreeRef({
      selectedNodes: [],
      deselectAll: vi.fn(),
      get: vi.fn(),
      openParents: vi.fn(),
      select: vi.fn(),
    })

    renderHook(() => useSyncTreeWithActiveTab({
      treeRef,
      activeTabId: 'file-1',
      isTreeLoading: true,
    }), { wrapper: createWrapper(store) })

    expect(requestAnimationFrameSpy).not.toHaveBeenCalled()
  })

  it('should clear tree selection when active tab is start tab', () => {
    const store = createWorkflowStore({})
    const deselectAll = vi.fn()
    const selectedNodes = [{ id: 'file-1' }] as unknown as TreeApi<TreeNodeData>['selectedNodes']
    const treeRef = createTreeRef({
      selectedNodes,
      deselectAll,
      get: vi.fn(),
      openParents: vi.fn(),
      select: vi.fn(),
    })

    renderHook(() => useSyncTreeWithActiveTab({
      treeRef,
      activeTabId: START_TAB_ID,
      isTreeLoading: false,
    }), { wrapper: createWrapper(store) })

    expect(deselectAll).toHaveBeenCalledTimes(1)
  })

  it('should leave selection untouched for artifact tabs when nothing is selected', () => {
    const store = createWorkflowStore({})
    const deselectAll = vi.fn()
    const treeRef = createTreeRef({
      selectedNodes: [],
      deselectAll,
      get: vi.fn(),
      openParents: vi.fn(),
      select: vi.fn(),
    })

    renderHook(() => useSyncTreeWithActiveTab({
      treeRef,
      activeTabId: 'artifact:file.png',
      isTreeLoading: false,
    }), { wrapper: createWrapper(store) })

    expect(deselectAll).not.toHaveBeenCalled()
  })

  it('should stop when the tree ref is not attached yet', () => {
    const store = createWorkflowStore({})

    renderHook(() => useSyncTreeWithActiveTab({
      treeRef: { current: null },
      activeTabId: 'file-1',
      isTreeLoading: false,
    }), { wrapper: createWrapper(store) })

    expect(store.getState().expandedFolderIds.size).toBe(0)
  })

  it('should reveal ancestors and select active file node when node exists', () => {
    const store = createWorkflowStore({})
    const openParents = vi.fn()
    const select = vi.fn()

    const root: MockTreeNode = { id: 'root', isRoot: true, parent: null }
    const folderA: MockTreeNode = { id: 'folder-a', isRoot: false, parent: root, isOpen: false }
    const folderB: MockTreeNode = { id: 'folder-b', isRoot: false, parent: folderA, isOpen: false }
    const fileNode: MockTreeNode = {
      id: 'file-1',
      isRoot: false,
      parent: folderB,
      isSelected: false,
      isFocused: false,
    }

    const treeRef = createTreeRef({
      selectedNodes: [],
      deselectAll: vi.fn(),
      get: vi.fn(() => fileNode),
      openParents,
      select,
    })

    renderHook(() => useSyncTreeWithActiveTab({
      treeRef,
      activeTabId: 'file-1',
      isTreeLoading: false,
    }), { wrapper: createWrapper(store) })

    expect(openParents).toHaveBeenCalledWith(fileNode)
    expect(select).toHaveBeenCalledWith('file-1')
    expect(store.getState().expandedFolderIds.has('folder-a')).toBe(true)
    expect(store.getState().expandedFolderIds.has('folder-b')).toBe(true)
  })

  it('should skip select when node is already selected even when tree focus is lost', () => {
    const store = createWorkflowStore({})
    const openParents = vi.fn()
    const select = vi.fn()

    const root: MockTreeNode = { id: 'root', isRoot: true, parent: null }
    const fileNode: MockTreeNode = {
      id: 'file-1',
      isRoot: false,
      parent: root,
      isSelected: true,
      isFocused: false,
    }

    const treeRef = createTreeRef({
      selectedNodes: [],
      deselectAll: vi.fn(),
      get: vi.fn(() => fileNode),
      openParents,
      select,
    })

    renderHook(() => useSyncTreeWithActiveTab({
      treeRef,
      activeTabId: 'file-1',
      isTreeLoading: false,
    }), { wrapper: createWrapper(store) })

    expect(openParents).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('should avoid reopening parents when every ancestor is already open', () => {
    const store = createWorkflowStore({})
    const openParents = vi.fn()
    const select = vi.fn()

    const root: MockTreeNode = { id: 'root', isRoot: true, parent: null }
    const folder: MockTreeNode = { id: 'folder-a', isRoot: false, parent: root, isOpen: true }
    const fileNode: MockTreeNode = {
      id: 'file-1',
      isRoot: false,
      parent: folder,
      isSelected: false,
      isFocused: false,
    }

    const treeRef = createTreeRef({
      selectedNodes: [],
      deselectAll: vi.fn(),
      get: vi.fn(() => fileNode),
      openParents,
      select,
    })

    renderHook(() => useSyncTreeWithActiveTab({
      treeRef,
      activeTabId: 'file-1',
      isTreeLoading: false,
    }), { wrapper: createWrapper(store) })

    expect(openParents).not.toHaveBeenCalled()
    expect(select).toHaveBeenCalledWith('file-1')
  })

  it('should retry syncing on syncSignal change when node appears later', () => {
    const store = createWorkflowStore({})
    const select = vi.fn()
    let node: MockTreeNode | undefined

    const root: MockTreeNode = { id: 'root', isRoot: true, parent: null }
    const treeRef = createTreeRef({
      selectedNodes: [],
      deselectAll: vi.fn(),
      get: vi.fn(() => node),
      openParents: vi.fn(),
      select,
    })

    const { rerender } = renderHook(
      ({ syncSignal }) => useSyncTreeWithActiveTab({
        treeRef,
        activeTabId: 'file-1',
        syncSignal,
        isTreeLoading: false,
      }),
      {
        initialProps: { syncSignal: 1 },
        wrapper: createWrapper(store),
      },
    )

    expect(select).not.toHaveBeenCalled()

    node = {
      id: 'file-1',
      isRoot: false,
      parent: root,
      isSelected: false,
      isFocused: false,
    }
    rerender({ syncSignal: 2 })

    expect(select).toHaveBeenCalledWith('file-1')
  })
})
