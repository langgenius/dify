'use client'

// Orchestrator hook for file operations - combines create and modify operations
// Maintains backward compatibility for existing consumers

import type { NodeApi, TreeApi } from 'react-arborist'
import type { TreeNodeData } from '../../../type'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { toApiParentId } from '../../../utils/tree-utils'
import { useSkillAssetTreeData } from '../data/use-skill-asset-tree'
import { useCreateOperations } from './use-create-operations'
import { useDownloadOperation } from './use-download-operation'
import { useModifyOperations } from './use-modify-operations'

type UseFileOperationsOptions = {
  nodeId?: string
  onClose: () => void
  treeRef?: React.RefObject<TreeApi<TreeNodeData> | null>
  node?: NodeApi<TreeNodeData>
  nodeType?: TreeNodeData['node_type']
  fileName?: string
}

export function useFileOperations({
  nodeId: explicitNodeId,
  onClose,
  treeRef,
  node,
  nodeType: explicitNodeType,
  fileName: explicitFileName,
}: UseFileOperationsOptions) {
  const nodeId = node?.data.id ?? explicitNodeId ?? ''
  const nodeType = node?.data.node_type ?? explicitNodeType
  const fileName = node?.data.name ?? explicitFileName

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id || ''
  const storeApi = useWorkflowStore()
  const { data: treeData } = useSkillAssetTreeData()

  const parentId = toApiParentId(nodeId)

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
    nodeType,
    appId,
    storeApi,
    treeData,
    onClose,
  })

  const downloadOps = useDownloadOperation({
    appId,
    nodeId,
    fileName,
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

    // Download operation
    handleDownload: downloadOps.handleDownload,

    // Combined loading states
    isLoading: createOps.isCreating || modifyOps.isDeleting || downloadOps.isDownloading,
    isDeleting: modifyOps.isDeleting,
    isDownloading: downloadOps.isDownloading,
  }
}
