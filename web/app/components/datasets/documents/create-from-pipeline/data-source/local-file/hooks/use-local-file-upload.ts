import type { CustomFile as File, FileItem } from '@/models/datasets'
import { produce } from 'immer'
import { useCallback, useRef } from 'react'
import { useFileUpload } from '@/app/components/datasets/create/file-uploader/hooks/use-file-upload'
import { useDataSourceStore, useDataSourceStoreWithSelector } from '../../store'

export type UseLocalFileUploadOptions = {
  allowedExtensions: string[]
  supportBatchUpload?: boolean
}

/**
 * Hook for handling local file uploads in the create-from-pipeline flow.
 * This is a thin wrapper around the generic useFileUpload hook that provides
 * Zustand store integration for state management.
 */
export const useLocalFileUpload = ({
  allowedExtensions,
  supportBatchUpload = true,
}: UseLocalFileUploadOptions) => {
  const localFileList = useDataSourceStoreWithSelector(state => state.localFileList)
  const dataSourceStore = useDataSourceStore()
  const fileListRef = useRef<FileItem[]>([])

  // Sync fileListRef with localFileList for internal tracking
  fileListRef.current = localFileList

  const prepareFileList = useCallback((files: FileItem[]) => {
    const { setLocalFileList } = dataSourceStore.getState()
    setLocalFileList(files)
    fileListRef.current = files
  }, [dataSourceStore])

  const onFileUpdate = useCallback((fileItem: FileItem, progress: number, list: FileItem[]) => {
    const { setLocalFileList } = dataSourceStore.getState()
    const newList = produce(list, (draft) => {
      const targetIndex = draft.findIndex(file => file.fileID === fileItem.fileID)
      if (targetIndex !== -1) {
        draft[targetIndex] = {
          ...draft[targetIndex],
          ...fileItem,
          progress,
        }
      }
    })
    setLocalFileList(newList)
  }, [dataSourceStore])

  const onFileListUpdate = useCallback((files: FileItem[]) => {
    const { setLocalFileList } = dataSourceStore.getState()
    setLocalFileList(files)
    fileListRef.current = files
  }, [dataSourceStore])

  const onPreview = useCallback((file: File) => {
    const { setCurrentLocalFile } = dataSourceStore.getState()
    setCurrentLocalFile(file)
  }, [dataSourceStore])

  const {
    dropRef,
    dragRef,
    fileUploaderRef,
    dragging,
    fileUploadConfig,
    acceptTypes,
    supportTypesShowNames,
    hideUpload,
    selectHandle,
    fileChangeHandle,
    removeFile,
    handlePreview,
  } = useFileUpload({
    fileList: localFileList,
    prepareFileList,
    onFileUpdate,
    onFileListUpdate,
    onPreview,
    supportBatchUpload,
    allowedExtensions,
  })

  return {
    // Refs
    dropRef,
    dragRef,
    fileUploaderRef,

    // State
    dragging,
    localFileList,

    // Config
    fileUploadConfig,
    acceptTypes,
    supportTypesShowNames,
    hideUpload,

    // Handlers
    selectHandle,
    fileChangeHandle,
    removeFile,
    handlePreview,
  }
}
