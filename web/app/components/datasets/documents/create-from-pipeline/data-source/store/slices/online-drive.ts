import type { StateCreator } from 'zustand'
import type { OnlineDriveFile } from '@/models/pipeline'

export type OnlineDriveSliceShape = {
  prefix: string[]
  setPrefix: (prefix: string[]) => void
  keywords: string
  setKeywords: (keywords: string) => void
  selectedFileList: string[]
  setSelectedFileList: (selectedFileList: string[]) => void
  fileList: OnlineDriveFile[]
  setFileList: (fileList: OnlineDriveFile[]) => void
  bucket: string
  setBucket: (bucket: string) => void
  startAfter: React.MutableRefObject<string>
  isTruncated: React.MutableRefObject<boolean>
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
    startAfter: { current: '' },
    selectedFileList: [],
    setSelectedFileList: (selectedFileList: string[]) => set(() => ({
      selectedFileList,
    })),
    fileList: [],
    setFileList: (fileList: OnlineDriveFile[]) => set(() => ({
      fileList,
    })),
    bucket: '',
    setBucket: (bucket: string) => set(() => ({
      bucket,
    })),
    isTruncated: { current: false },
  })
}
