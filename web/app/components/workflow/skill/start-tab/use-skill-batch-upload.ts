import type { BatchUploadNodeInput, BatchUploadNodeOutput } from '@/types/app-asset'
import { useCallback } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useBatchUpload } from '@/service/use-app-asset'
import { useSkillTreeUpdateEmitter } from '../hooks/file-tree/data/use-skill-tree-collaboration'

type UploadTreeParams = {
  tree: BatchUploadNodeInput[]
  files: Map<string, File>
}

const createProgress = (uploaded: number, total: number) => ({
  uploaded,
  total,
  failed: 0,
})

function findSkillDocumentNodeId(nodes: BatchUploadNodeOutput[]): string | null {
  const queue = [...nodes]

  while (queue.length > 0) {
    const node = queue.shift()!
    if (node.name === 'SKILL.md')
      return node.id

    if (node.children.length > 0)
      queue.push(...node.children)
  }

  return null
}

export const useSkillBatchUpload = () => {
  const appId = useAppStore(s => s.appDetail?.id || '')
  const storeApi = useWorkflowStore()
  const { mutateAsync } = useBatchUpload()
  const emitTreeUpdate = useSkillTreeUpdateEmitter()

  const startUpload = useCallback((total: number) => {
    const normalizedTotal = Math.max(total, 0)
    const state = storeApi.getState()
    state.setUploadStatus('uploading')
    state.setUploadProgress(createProgress(0, normalizedTotal))
  }, [storeApi])

  const setUploadProgress = useCallback((uploaded: number, total: number) => {
    storeApi.getState().setUploadProgress(createProgress(uploaded, total))
  }, [storeApi])

  const failUpload = useCallback(() => {
    storeApi.getState().setUploadStatus('partial_error')
  }, [storeApi])

  const uploadTree = useCallback(async ({
    tree,
    files,
  }: UploadTreeParams): Promise<BatchUploadNodeOutput[]> => {
    if (!appId)
      return []

    const createdNodes = await mutateAsync({
      appId,
      tree,
      files,
      parentId: null,
      onProgress: setUploadProgress,
    })

    storeApi.getState().setUploadStatus('success')
    emitTreeUpdate()
    return createdNodes
  }, [appId, emitTreeUpdate, mutateAsync, setUploadProgress, storeApi])

  const openCreatedSkillDocument = useCallback((nodes: BatchUploadNodeOutput[]): string | null => {
    const skillDocumentId = findSkillDocumentNodeId(nodes)
    if (skillDocumentId)
      storeApi.getState().openTab(skillDocumentId, { pinned: true })
    return skillDocumentId
  }, [storeApi])

  return {
    appId,
    startUpload,
    setUploadProgress,
    failUpload,
    uploadTree,
    openCreatedSkillDocument,
  }
}
