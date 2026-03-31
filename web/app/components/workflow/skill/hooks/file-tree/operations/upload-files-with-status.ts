import type { StoreApi } from 'zustand'
import type { SkillEditorSliceShape } from '@/app/components/workflow/store/workflow/skill-editor/types'
import type { AppAssetNode } from '@/types/app-asset'
import { prepareSkillUploadFile } from '../../../utils/skill-upload-utils'

type UploadFilesWithStatusOptions = {
  files: File[]
  appId: string
  parentId: string | null
  storeApi: StoreApi<SkillEditorSliceShape>
  uploadFile: (payload: {
    appId: string
    file: File
    parentId: string | null
  }) => Promise<AppAssetNode>
}

export type UploadFilesWithStatusResult = {
  uploadedNodes: AppAssetNode[]
  uploaded: number
  total: number
  failed: number
  status: 'success' | 'partial_error'
}

export const uploadFilesWithStatus = async ({
  files,
  appId,
  parentId,
  storeApi,
  uploadFile,
}: UploadFilesWithStatusOptions): Promise<UploadFilesWithStatusResult> => {
  const total = files.length
  const progress = { uploaded: 0, failed: 0 }

  storeApi.getState().setUploadStatus('uploading')
  storeApi.getState().setUploadProgress({ uploaded: 0, total, failed: 0 })

  const preparedFiles = await Promise.all(files.map(async (file) => {
    try {
      return await prepareSkillUploadFile(file)
    }
    catch {
      progress.failed++
      storeApi.getState().setUploadProgress({ uploaded: progress.uploaded, total, failed: progress.failed })
      return null
    }
  }))

  const uploadedNodes = (await Promise.all(
    preparedFiles
      .filter((file): file is File => !!file)
      .map(async (file) => {
        try {
          const node = await uploadFile({ appId, file, parentId })
          progress.uploaded++
          return node
        }
        catch {
          progress.failed++
          return null
        }
        finally {
          storeApi.getState().setUploadProgress({ uploaded: progress.uploaded, total, failed: progress.failed })
        }
      }),
  )).filter((node): node is AppAssetNode => !!node)

  const status = progress.failed > 0 ? 'partial_error' : 'success'
  storeApi.getState().setUploadStatus(status)
  storeApi.getState().setUploadProgress({ uploaded: progress.uploaded, total, failed: progress.failed })

  return {
    uploadedNodes,
    uploaded: progress.uploaded,
    total,
    failed: progress.failed,
    status,
  }
}
