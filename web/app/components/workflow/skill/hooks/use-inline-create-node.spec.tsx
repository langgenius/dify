import type { ReactNode } from 'react'
import type { TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import type { App, AppSSO } from '@/types/app'
import { act, renderHook } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { START_TAB_ID } from '../constants'
import { useInlineCreateNode } from './use-inline-create-node'

const {
  mockUploadMutateAsync,
  mockCreateFolderMutateAsync,
  mockRenameMutateAsync,
  mockEmitTreeUpdate,
  mockToastNotify,
} = vi.hoisted(() => ({
  mockUploadMutateAsync: vi.fn(),
  mockCreateFolderMutateAsync: vi.fn(),
  mockRenameMutateAsync: vi.fn(),
  mockEmitTreeUpdate: vi.fn(),
  mockToastNotify: vi.fn(),
}))

vi.mock('@/service/use-app-asset', () => ({
  useUploadFileWithPresignedUrl: () => ({
    mutateAsync: mockUploadMutateAsync,
  }),
  useCreateAppAssetFolder: () => ({
    mutateAsync: mockCreateFolderMutateAsync,
  }),
  useRenameAppAssetNode: () => ({
    mutateAsync: mockRenameMutateAsync,
  }),
}))

vi.mock('./use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mockEmitTreeUpdate,
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mockToastNotify,
  },
}))

const createWrapper = (store: ReturnType<typeof createWorkflowStore>) => {
  return ({ children }: { children: ReactNode }) => (
    <WorkflowContext.Provider value={store}>
      {children}
    </WorkflowContext.Provider>
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
    mockUploadMutateAsync.mockResolvedValue({
      id: 'file-1',
      extension: 'md',
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

    expect(mockUploadMutateAsync).toHaveBeenCalledTimes(1)
    expect(store.getState().activeTabId).toBe('file-1')
    expect(store.getState().editorAutoFocusFileId).toBe('file-1')
    expect(store.getState().openTabIds).toEqual(['file-1'])
    expect(store.getState().pendingCreateNode).toBeNull()
  })

  it('should not open tab for non-text-like created files', async () => {
    const store = createWorkflowStore({})
    const treeRef = { current: null } as React.RefObject<TreeApi<TreeNodeData> | null>
    mockUploadMutateAsync.mockResolvedValue({
      id: 'file-2',
      extension: 'png',
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

    expect(mockUploadMutateAsync).toHaveBeenCalledTimes(1)
    expect(store.getState().activeTabId).toBe(START_TAB_ID)
    expect(store.getState().editorAutoFocusFileId).toBeNull()
    expect(store.getState().openTabIds).toEqual([])
    expect(store.getState().pendingCreateNode).toBeNull()
  })
})
