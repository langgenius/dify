import type { StateCreator } from 'zustand'
import type { DocumentItem, CustomFile as File, FileItem } from '@/models/datasets'

export type LocalFileSliceShape = {
  localFileList: FileItem[]
  setLocalFileList: (fileList: FileItem[]) => void
  currentLocalFile: File | undefined
  setCurrentLocalFile: (file: File | undefined) => void
  previewLocalFileRef: React.RefObject<DocumentItem | undefined>
}

export const createLocalFileSlice: StateCreator<LocalFileSliceShape> = (set, get) => {
  return ({
    localFileList: [],
    setLocalFileList: (fileList: FileItem[]) => {
      set(() => ({
        localFileList: fileList,
      }))
      const { previewLocalFileRef } = get()
      previewLocalFileRef.current = fileList[0]?.file as DocumentItem
    },
    currentLocalFile: undefined,
    setCurrentLocalFile: (file: File | undefined) => set(() => ({
      currentLocalFile: file,
    })),
    previewLocalFileRef: { current: undefined },
  })
}
