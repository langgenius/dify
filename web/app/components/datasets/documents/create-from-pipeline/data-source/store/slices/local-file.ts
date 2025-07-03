import type { StateCreator } from 'zustand'
import type { FileItem } from '@/models/datasets'

export type LocalFileSliceShape = {
  localFileList: FileItem[]
  setLocalFileList: (fileList: FileItem[]) => void
  currentLocalFile: File | undefined
  setCurrentLocalFile: (file: File | undefined) => void
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
  })
}
