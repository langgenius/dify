import type { SandboxFileTreeNode } from '@/types/sandbox-file'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { sandboxFileDownloadUrlOptions, sandboxFilesTreeOptions, useDownloadSandboxFile } from '@/service/use-sandbox-file'
import { downloadUrl } from '@/utils/download'
import { buildTreeFromFlatList } from '../../skill/file-tree/artifacts/utils'
import { useStore } from '../../store'
import { WorkflowRunningStatus } from '../../types'

type PathSegment = {
  part: string
  key: string
  isFirst: boolean
  isLast: boolean
}

export type ArtifactsInspectStatus = 'loading' | 'empty' | 'split'

export type ArtifactsInspectView = {
  downloadUrlData?: { download_url?: string }
  handleFileSelect: (node: SandboxFileTreeNode) => void
  handleSelectedFileDownload: () => void
  handleTreeDownload: (node: SandboxFileTreeNode) => Promise<void>
  isDownloadUrlLoading: boolean
  isDownloading: boolean
  pathSegments: PathSegment[]
  selectedFile: SandboxFileTreeNode | null
  selectedFilePath?: string
  status: ArtifactsInspectStatus
  treeData?: SandboxFileTreeNode[]
}

export const useArtifactsInspectView = (): ArtifactsInspectView => {
  const appId = useStore(s => s.appId)
  const isWorkflowRunning = useStore(
    s => s.workflowRunningData?.result?.status === WorkflowRunningStatus.Running,
  )
  const isResponding = useStore(s => s.isResponding)

  const { data: flatData, isLoading } = useQuery({
    ...sandboxFilesTreeOptions(appId),
    refetchInterval: (isWorkflowRunning || isResponding) ? 5000 : false,
  })
  const treeData = useMemo(() => flatData ? buildTreeFromFlatList(flatData) : undefined, [flatData])
  const hasFiles = (flatData?.length ?? 0) > 0
  const { mutateAsync: fetchDownloadUrl, isPending: isDownloading } = useDownloadSandboxFile(appId)
  const [selectedFile, setSelectedFile] = useState<SandboxFileTreeNode | null>(null)

  const selectedFilePath = useMemo(() => {
    if (!selectedFile)
      return undefined

    const selectedExists = flatData?.some(node => !node.is_dir && node.path === selectedFile.path) ?? false
    return selectedExists ? selectedFile.path : undefined
  }, [flatData, selectedFile])

  const { data: downloadUrlData, isLoading: isDownloadUrlLoading } = useQuery({
    ...sandboxFileDownloadUrlOptions(appId, selectedFilePath),
    retry: false,
  })

  const handleFileSelect = useCallback((node: SandboxFileTreeNode) => {
    if (node.node_type === 'file')
      setSelectedFile(node)
  }, [])

  const handleTreeDownload = useCallback(async (node: SandboxFileTreeNode) => {
    try {
      const ticket = await fetchDownloadUrl(node.path)
      downloadUrl({ url: ticket.download_url, fileName: node.name })
    }
    catch (error) {
      console.error('Download failed:', error)
    }
  }, [fetchDownloadUrl])

  const handleSelectedFileDownload = useCallback(() => {
    if (downloadUrlData?.download_url && selectedFile)
      downloadUrl({ url: downloadUrlData.download_url, fileName: selectedFile.name })
  }, [downloadUrlData, selectedFile])

  const pathSegments = useMemo(() => {
    const parts = selectedFilePath ? selectedFilePath.split('/') : []
    let cumPath = ''
    return parts.map((part, index) => {
      cumPath += `${cumPath ? '/' : ''}${part}`
      return {
        part,
        key: cumPath,
        isFirst: index === 0,
        isLast: index === parts.length - 1,
      }
    })
  }, [selectedFilePath])

  if (isLoading) {
    return {
      downloadUrlData,
      handleFileSelect,
      handleSelectedFileDownload,
      handleTreeDownload,
      isDownloadUrlLoading,
      isDownloading,
      pathSegments,
      selectedFile,
      selectedFilePath,
      status: 'loading',
      treeData,
    }
  }

  if (!hasFiles) {
    return {
      downloadUrlData,
      handleFileSelect,
      handleSelectedFileDownload,
      handleTreeDownload,
      isDownloadUrlLoading,
      isDownloading,
      pathSegments,
      selectedFile,
      selectedFilePath,
      status: 'empty',
      treeData,
    }
  }

  return {
    downloadUrlData,
    handleFileSelect,
    handleSelectedFileDownload,
    handleTreeDownload,
    isDownloadUrlLoading,
    isDownloading,
    pathSegments,
    selectedFile,
    selectedFilePath,
    status: 'split',
    treeData,
  }
}
