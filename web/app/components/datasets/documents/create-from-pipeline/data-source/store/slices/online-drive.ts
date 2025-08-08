import type { StateCreator } from 'zustand'
import type { OnlineDriveFile } from '@/models/pipeline'

export type OnlineDriveSliceShape = {
  prefix: string[]
  setPrefix: (prefix: string[]) => void
  keywords: string
  setKeywords: (keywords: string) => void
  selectedFileKeys: string[]
  setSelectedFileKeys: (selectedFileKeys: string[]) => void
  fileList: OnlineDriveFile[]
  setFileList: (fileList: OnlineDriveFile[]) => void
  bucket: string
  setBucket: (bucket: string) => void
  startAfter: string
  setStartAfter: (startAfter: string) => void
  isTruncated: React.RefObject<boolean>
  previewOnlineDriveFileRef: React.RefObject<OnlineDriveFile | undefined>
}

export const createOnlineDriveSlice: StateCreator<OnlineDriveSliceShape> = (set, get) => {
  return ({
    prefix: [],
    setPrefix: (prefix: string[]) => set(() => ({
      prefix,
    })),
    keywords: '',
    setKeywords: (keywords: string) => set(() => ({
      keywords,
    })),
    selectedFileKeys: [],
    setSelectedFileKeys: (selectedFileKeys: string[]) => {
      set(() => ({
        selectedFileKeys,
      }))
      const key = selectedFileKeys[0]
      const { fileList, previewOnlineDriveFileRef } = get()
      previewOnlineDriveFileRef.current = fileList.find(file => file.key === key)
    },
    fileList: [],
    setFileList: (fileList: OnlineDriveFile[]) => set(() => ({
      fileList,
    })),
    bucket: '',
    setBucket: (bucket: string) => set(() => ({
      bucket,
    })),
    startAfter: '',
    setStartAfter: (startAfter: string) => set(() => ({
      startAfter,
    })),
    isTruncated: { current: false },
    previewOnlineDriveFileRef: { current: undefined },
  })
}
