import type { RefObject } from 'react'
import type { NodeApi, TreeApi } from 'react-arborist'
import type { StoreApi } from 'zustand'
import type { TreeNodeData } from '../../../type'
import type { SkillEditorSliceShape } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { AppAssetTreeResponse } from '@/types/app-asset'
import { renderHook } from '@testing-library/react'
import { useFileOperations } from './use-file-operations'

type AppStoreState = {
  appDetail?: {
    id: string
  } | null
}

type CreateOpsResult = {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  folderInputRef: React.RefObject<HTMLInputElement | null>
  handleNewFile: () => void
  handleNewFolder: () => void
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  handleFolderChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  isCreating: boolean
}

type ModifyOpsResult = {
  showDeleteConfirm: boolean
  handleRename: () => void
  handleDeleteClick: () => void
  handleDeleteConfirm: () => Promise<void>
  handleDeleteCancel: () => void
  isDeleting: boolean
}

type DownloadOpsResult = {
  handleDownload: () => Promise<void>
  isDownloading: boolean
}

const createDefaultCreateOps = (): CreateOpsResult => ({
  fileInputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
  folderInputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
  handleNewFile: vi.fn(),
  handleNewFolder: vi.fn(),
  handleFileChange: vi.fn(async () => undefined),
  handleFolderChange: vi.fn(async () => undefined),
  isCreating: false,
})

const createDefaultModifyOps = (): ModifyOpsResult => ({
  showDeleteConfirm: false,
  handleRename: vi.fn(),
  handleDeleteClick: vi.fn(),
  handleDeleteConfirm: vi.fn(async () => undefined),
  handleDeleteCancel: vi.fn(),
  isDeleting: false,
})

const createDefaultDownloadOps = (): DownloadOpsResult => ({
  handleDownload: vi.fn(async () => undefined),
  isDownloading: false,
})

const mocks = vi.hoisted(() => {
  const workflowStore = {} as StoreApi<SkillEditorSliceShape>
  const fileInputRef = { current: null } as React.RefObject<HTMLInputElement | null>
  const folderInputRef = { current: null } as React.RefObject<HTMLInputElement | null>
  return {
    appStoreState: {
      appDetail: { id: 'app-1' },
    } as AppStoreState,
    workflowStore,
    treeData: {
      children: [],
    } as AppAssetTreeResponse,
    toApiParentId: vi.fn<(folderId: string | null | undefined) => string | null>(),
    createOpsHook: vi.fn<(options: {
      parentId: string | null
      appId: string
      storeApi: StoreApi<SkillEditorSliceShape>
      onClose: () => void
    }) => CreateOpsResult>(),
    modifyOpsHook: vi.fn<(options: {
      nodeId: string
      node?: NodeApi<TreeNodeData>
      treeRef?: RefObject<TreeApi<TreeNodeData> | null>
      appId: string
      storeApi: StoreApi<SkillEditorSliceShape>
      treeData?: AppAssetTreeResponse
      onClose: () => void
    }) => ModifyOpsResult>(),
    downloadOpsHook: vi.fn<(options: {
      appId: string
      nodeId: string
      fileName?: string
      onClose: () => void
    }) => DownloadOpsResult>(),
    createOpsResult: {
      fileInputRef,
      folderInputRef,
      handleNewFile: vi.fn<() => void>(),
      handleNewFolder: vi.fn<() => void>(),
      handleFileChange: vi.fn<(e: React.ChangeEvent<HTMLInputElement>) => Promise<void>>(async () => undefined),
      handleFolderChange: vi.fn<(e: React.ChangeEvent<HTMLInputElement>) => Promise<void>>(async () => undefined),
      isCreating: false,
    } as CreateOpsResult,
    modifyOpsResult: {
      showDeleteConfirm: false,
      handleRename: vi.fn<() => void>(),
      handleDeleteClick: vi.fn<() => void>(),
      handleDeleteConfirm: vi.fn<() => Promise<void>>(async () => undefined),
      handleDeleteCancel: vi.fn<() => void>(),
      isDeleting: false,
    } as ModifyOpsResult,
    downloadOpsResult: {
      handleDownload: vi.fn<() => Promise<void>>(async () => undefined),
      isDownloading: false,
    } as DownloadOpsResult,
  }
})

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: AppStoreState) => unknown) => selector(mocks.appStoreState),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => mocks.workflowStore,
}))

vi.mock('../data/use-skill-asset-tree', () => ({
  useSkillAssetTreeData: () => ({
    data: mocks.treeData,
  }),
}))

vi.mock('../../../utils/tree-utils', () => ({
  toApiParentId: mocks.toApiParentId,
}))

vi.mock('./use-create-operations', () => ({
  useCreateOperations: (options: {
    parentId: string | null
    appId: string
    storeApi: StoreApi<SkillEditorSliceShape>
    onClose: () => void
  }) => mocks.createOpsHook(options),
}))

vi.mock('./use-modify-operations', () => ({
  useModifyOperations: (options: {
    nodeId: string
    node?: NodeApi<TreeNodeData>
    treeRef?: RefObject<TreeApi<TreeNodeData> | null>
    appId: string
    storeApi: StoreApi<SkillEditorSliceShape>
    treeData?: AppAssetTreeResponse
    onClose: () => void
  }) => mocks.modifyOpsHook(options),
}))

vi.mock('./use-download-operation', () => ({
  useDownloadOperation: (options: {
    appId: string
    nodeId: string
    fileName?: string
    onClose: () => void
  }) => mocks.downloadOpsHook(options),
}))

const createNodeApi = (id: string, name: string): NodeApi<TreeNodeData> => {
  return {
    data: {
      id,
      node_type: 'file',
      name,
      path: `/${id}`,
      extension: 'md',
      size: 1,
      children: [],
    },
  } as unknown as NodeApi<TreeNodeData>
}

describe('useFileOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appStoreState.appDetail = { id: 'app-1' }
    mocks.treeData = { children: [] }
    mocks.toApiParentId.mockReturnValue('parent-api-id')
    mocks.createOpsResult = createDefaultCreateOps()
    mocks.modifyOpsResult = createDefaultModifyOps()
    mocks.downloadOpsResult = createDefaultDownloadOps()
    mocks.createOpsHook.mockImplementation(() => mocks.createOpsResult)
    mocks.modifyOpsHook.mockImplementation(() => mocks.modifyOpsResult)
    mocks.downloadOpsHook.mockImplementation(() => mocks.downloadOpsResult)
  })

  // Scenario: node id and wiring should prioritize selected node over explicit id.
  describe('Hook wiring', () => {
    it('should use node data id and pass expected options to child operation hooks', () => {
      const node = createNodeApi('node-from-node', 'from-node.md')
      const treeRef = { current: null } as RefObject<TreeApi<TreeNodeData> | null>
      const onClose = vi.fn()

      const { result } = renderHook(() => useFileOperations({
        nodeId: 'explicit-node',
        node,
        treeRef,
        onClose,
      }))

      expect(mocks.toApiParentId).toHaveBeenCalledWith('node-from-node')
      expect(mocks.createOpsHook).toHaveBeenCalledWith({
        parentId: 'parent-api-id',
        appId: 'app-1',
        storeApi: mocks.workflowStore,
        onClose,
      })
      expect(mocks.modifyOpsHook).toHaveBeenCalledWith({
        nodeId: 'node-from-node',
        node,
        treeRef,
        appId: 'app-1',
        storeApi: mocks.workflowStore,
        treeData: mocks.treeData,
        onClose,
      })
      expect(mocks.downloadOpsHook).toHaveBeenCalledWith({
        appId: 'app-1',
        nodeId: 'node-from-node',
        fileName: 'from-node.md',
        onClose,
      })

      expect(result.current.handleNewFile).toBe(mocks.createOpsResult.handleNewFile)
      expect(result.current.handleRename).toBe(mocks.modifyOpsResult.handleRename)
      expect(result.current.handleDownload).toBe(mocks.downloadOpsResult.handleDownload)
    })

    it('should fallback to explicit nodeId when node is not provided', () => {
      const onClose = vi.fn()

      renderHook(() => useFileOperations({
        nodeId: 'explicit-only',
        onClose,
      }))

      expect(mocks.toApiParentId).toHaveBeenCalledWith('explicit-only')
      expect(mocks.downloadOpsHook).toHaveBeenCalledWith({
        appId: 'app-1',
        nodeId: 'explicit-only',
        fileName: undefined,
        onClose,
      })
    })

    it('should fallback to empty nodeId when both node and explicit nodeId are missing', () => {
      const onClose = vi.fn()

      renderHook(() => useFileOperations({
        onClose,
      }))

      expect(mocks.toApiParentId).toHaveBeenCalledWith('')
      expect(mocks.modifyOpsHook).toHaveBeenCalledWith({
        nodeId: '',
        node: undefined,
        treeRef: undefined,
        appId: 'app-1',
        storeApi: mocks.workflowStore,
        treeData: mocks.treeData,
        onClose,
      })
    })
  })

  // Scenario: returned values should pass through child hook outputs and aggregate loading state.
  describe('Return shape', () => {
    it('should expose all operation handlers and refs from composed hooks', () => {
      const onClose = vi.fn()

      const { result } = renderHook(() => useFileOperations({ onClose }))

      expect(result.current.fileInputRef).toBe(mocks.createOpsResult.fileInputRef)
      expect(result.current.folderInputRef).toBe(mocks.createOpsResult.folderInputRef)
      expect(result.current.handleNewFile).toBe(mocks.createOpsResult.handleNewFile)
      expect(result.current.handleNewFolder).toBe(mocks.createOpsResult.handleNewFolder)
      expect(result.current.handleFileChange).toBe(mocks.createOpsResult.handleFileChange)
      expect(result.current.handleFolderChange).toBe(mocks.createOpsResult.handleFolderChange)
      expect(result.current.showDeleteConfirm).toBe(mocks.modifyOpsResult.showDeleteConfirm)
      expect(result.current.handleRename).toBe(mocks.modifyOpsResult.handleRename)
      expect(result.current.handleDeleteClick).toBe(mocks.modifyOpsResult.handleDeleteClick)
      expect(result.current.handleDeleteConfirm).toBe(mocks.modifyOpsResult.handleDeleteConfirm)
      expect(result.current.handleDeleteCancel).toBe(mocks.modifyOpsResult.handleDeleteCancel)
      expect(result.current.handleDownload).toBe(mocks.downloadOpsResult.handleDownload)
      expect(result.current.isDeleting).toBe(mocks.modifyOpsResult.isDeleting)
      expect(result.current.isDownloading).toBe(mocks.downloadOpsResult.isDownloading)
    })

    it('should compute isLoading as false when all child hooks are idle', () => {
      const { result } = renderHook(() => useFileOperations({ onClose: vi.fn() }))

      expect(result.current.isLoading).toBe(false)
    })

    it.each([
      {
        name: 'create operation is pending',
        isCreating: true,
        isDeleting: false,
        isDownloading: false,
      },
      {
        name: 'delete operation is pending',
        isCreating: false,
        isDeleting: true,
        isDownloading: false,
      },
      {
        name: 'download operation is pending',
        isCreating: false,
        isDeleting: false,
        isDownloading: true,
      },
    ])('should compute isLoading as true when $name', ({ isCreating, isDeleting, isDownloading }) => {
      mocks.createOpsResult.isCreating = isCreating
      mocks.modifyOpsResult.isDeleting = isDeleting
      mocks.downloadOpsResult.isDownloading = isDownloading

      const { result } = renderHook(() => useFileOperations({ onClose: vi.fn() }))

      expect(result.current.isLoading).toBe(true)
    })
  })
})
