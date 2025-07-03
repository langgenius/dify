import type { StateCreator } from 'zustand'
import type { DocumentItem, FileItem } from '@/models/datasets'

export type LocalFileSliceShape = {
  localFileList: FileItem[]
  setLocalFileList: (fileList: FileItem[]) => void
  currentLocalFile: File | undefined
  setCurrentLocalFile: (file: File | undefined) => void
  previewLocalFileRef: React.MutableRefObject<DocumentItem | undefined>
}

export const createLocalFileSlice: StateCreator<LocalFileSliceShape> = (set) => {
  return ({
    localFileList: [],
    setLocalFileList: (fileList: FileItem[]) => set(() => ({
      localFileList: fileList,
    })),
    currentLocalFile: undefined,
    setCurrentLocalFile: (file: File | undefined) => set(() => ({
      currentLocalFile: file,
    })),
    previewLocalFileRef: { current: undefined },
  })
}
