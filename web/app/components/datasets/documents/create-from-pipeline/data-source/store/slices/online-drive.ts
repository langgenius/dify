import type { StateCreator } from 'zustand'
import { type OnlineDriveFile, OnlineDriveFileType } from '@/models/pipeline'

export type OnlineDriveSliceShape = {
  prefix: string[]
  setPrefix: (prefix: string[]) => void
  keywords: string
  setKeywords: (keywords: string) => void
  startAfter: string
  setStartAfter: (startAfter: string) => void
  selectedFileList: string[]
  setSelectedFileList: (selectedFileList: string[]) => void
  fileList: OnlineDriveFile[]
  setFileList: (fileList: OnlineDriveFile[]) => void
}

export const createOnlineDriveSlice: StateCreator<OnlineDriveSliceShape> = (set) => {
  return ({
    prefix: [],
    setPrefix: (prefix: string[]) => set(() => ({
      prefix,
    })),
    keywords: '',
    setKeywords: (keywords: string) => set(() => ({
      keywords,
    })),
    startAfter: '',
    setStartAfter: (startAfter: string) => set(() => ({
      startAfter,
    })),
    selectedFileList: [],
    setSelectedFileList: (selectedFileList: string[]) => set(() => ({
      selectedFileList,
    })),
    fileList: [{
      key: 'Bucket_1',
      size: 1024, // unit bytes
      type: OnlineDriveFileType.bucket,
    }],
    setFileList: (fileList: OnlineDriveFile[]) => set(() => ({
      fileList,
    })),
  })
}
