'use client'

// Orchestrator hook for file operations - combines create and modify operations
// Maintains backward compatibility for existing consumers

import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../type'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useCreateOperations } from './use-create-operations'
import { useModifyOperations } from './use-modify-operations'
import { useSkillAssetTreeData } from './use-skill-asset-tree'

type UseFileOperationsOptions = {
  nodeId?: string
  onClose: () => void
  treeRef?: React.RefObject<TreeApi<TreeNodeData> | null>
  node?: NodeApi<TreeNodeData>
}

export function useFileOperations({
  nodeId: explicitNodeId,
  onClose,
  treeRef,
  node,
}: UseFileOperationsOptions) {
  const nodeId = node?.data.id ?? explicitNodeId ?? ''

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const storeApi = useWorkflowStore()
  const { data: treeData } = useSkillAssetTreeData()

  const parentId = nodeId === 'root' ? null : nodeId

  const createOps = useCreateOperations({
    parentId,
    appId,
    storeApi,
    onClose,
  })

  const modifyOps = useModifyOperations({
    nodeId,
    node,
    treeRef,
    appId,
    storeApi,
    treeData,
    onClose,
  })

  return {
    // Create operations
    fileInputRef: createOps.fileInputRef,
    folderInputRef: createOps.folderInputRef,
    handleNewFile: createOps.handleNewFile,
    handleNewFolder: createOps.handleNewFolder,
    handleFileChange: createOps.handleFileChange,
    handleFolderChange: createOps.handleFolderChange,

    // Modify operations
    showDeleteConfirm: modifyOps.showDeleteConfirm,
    handleRename: modifyOps.handleRename,
    handleDeleteClick: modifyOps.handleDeleteClick,
    handleDeleteConfirm: modifyOps.handleDeleteConfirm,
    handleDeleteCancel: modifyOps.handleDeleteCancel,

    // Combined loading states
    isLoading: createOps.isCreating || modifyOps.isDeleting,
    isDeleting: modifyOps.isDeleting,
  }
}
