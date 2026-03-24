import type { ReactNode } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../../type'
import type { App, AppSSO } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { START_TAB_ID } from '../../../constants'
import { useInlineCreateNode } from './use-inline-create-node'

const {
  mockUploadMutate,
  mockCreateFolderMutate,
  mockRenameMutate,
  mockEmitTreeUpdate,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockUploadMutate: vi.fn(),
  mockCreateFolderMutate: vi.fn(),
  mockRenameMutate: vi.fn(),
  mockEmitTreeUpdate: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/service/use-app-asset', () => ({
  useUploadFileWithPresignedUrl: () => ({
    mutate: mockUploadMutate,
  }),
  useCreateAppAssetFolder: () => ({
    mutate: mockCreateFolderMutate,
  }),
  useRenameAppAssetNode: () => ({
    mutate: mockRenameMutate,
  }),
}))

vi.mock('../data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mockEmitTreeUpdate,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

const createWrapper = (store: ReturnType<typeof createWorkflowStore>) => {
  return ({ children }: { children: ReactNode }) => (
    <WorkflowContext value={store}>
      {children}
    </WorkflowContext>
  )
}

describe('useInlineCreateNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  it('should open created text file tab with editor auto focus intent', async () => {
    const store = createWorkflowStore({})
    const treeRef = { current: null } as React.RefObject<TreeApi<TreeNodeData> | null>
    mockUploadMutate.mockImplementation((_, options) => {
      options?.onSuccess?.({
        id: 'file-1',
        extension: 'md',
      })
    })

    store.getState().startCreateNode('file', null)
    const pendingId = store.getState().pendingCreateNode?.id as string

    const { result } = renderHook(() => useInlineCreateNode({
      treeRef,
      treeChildren: [],
    }), { wrapper: createWrapper(store) })

    await act(async () => {
      await result.current.handleRename({
        id: pendingId,
        name: 'README.md',
      })
    })

    expect(mockUploadMutate).toHaveBeenCalledTimes(1)
    expect(store.getState().activeTabId).toBe('file-1')
    expect(store.getState().editorAutoFocusFileId).toBe('file-1')
    expect(store.getState().openTabIds).toEqual(['file-1'])
    expect(store.getState().pendingCreateNode).toBeNull()
    expect(mockToastSuccess).toHaveBeenCalledWith('workflow.skillSidebar.menu.fileCreated')
  })

  it('should not open tab for non-text-like created files', async () => {
    const store = createWorkflowStore({})
    const treeRef = { current: null } as React.RefObject<TreeApi<TreeNodeData> | null>
    mockUploadMutate.mockImplementation((_, options) => {
      options?.onSuccess?.({
        id: 'file-2',
        extension: 'png',
      })
    })

    store.getState().startCreateNode('file', null)
    const pendingId = store.getState().pendingCreateNode?.id as string

    const { result } = renderHook(() => useInlineCreateNode({
      treeRef,
      treeChildren: [],
    }), { wrapper: createWrapper(store) })

    await act(async () => {
      await result.current.handleRename({
        id: pendingId,
        name: 'image.png',
      })
    })

    expect(mockUploadMutate).toHaveBeenCalledTimes(1)
    expect(store.getState().activeTabId).toBe(START_TAB_ID)
    expect(store.getState().editorAutoFocusFileId).toBeNull()
    expect(store.getState().openTabIds).toEqual([])
    expect(store.getState().pendingCreateNode).toBeNull()
  })

  it('should wait for rename mutation callbacks before resolving existing node rename', async () => {
    const store = createWorkflowStore({})
    const treeRef = { current: null } as React.RefObject<TreeApi<TreeNodeData> | null>
    let onSuccess: (() => void) | undefined
    mockRenameMutate.mockImplementation((_, options) => {
      onSuccess = () => options?.onSuccess?.({})
    })

    const { result } = renderHook(() => useInlineCreateNode({
      treeRef,
      treeChildren: [],
    }), { wrapper: createWrapper(store) })

    let resolved = false
    const renamePromise = act(async () => {
      await result.current.handleRename({
        id: 'file-1',
        name: 'renamed.ts',
      })
      resolved = true
    })

    expect(resolved).toBe(false)

    onSuccess?.()
    await renamePromise

    expect(mockRenameMutate).toHaveBeenCalledTimes(1)
    expect(mockEmitTreeUpdate).toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledWith('workflow.skillSidebar.menu.renamed')
  })
})
