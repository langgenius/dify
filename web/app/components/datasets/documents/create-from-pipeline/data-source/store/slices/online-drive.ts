import type { StateCreator } from 'zustand'
import type { OnlineDriveFile } from '@/models/pipeline'

export type OnlineDriveSliceShape = {
  prefix: string[]
  setPrefix: (prefix: string[]) => void
  keywords: string
  setKeywords: (keywords: string) => void
  selectedFileIds: string[]
  setSelectedFileIds: (selectedFileIds: string[]) => void
  fileList: OnlineDriveFile[]
  setFileList: (fileList: OnlineDriveFile[]) => void
  bucket: string
  setBucket: (bucket: string) => void
  nextPageParameters: Record<string, any>
  currentNextPageParametersRef: React.RefObject<Record<string, any>>
  setNextPageParameters: (nextPageParameters: Record<string, any>) => void
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
    selectedFileIds: [],
    setSelectedFileIds: (selectedFileIds: string[]) => {
      set(() => ({
        selectedFileIds,
      }))
      const id = selectedFileIds[0]
      const { fileList, previewOnlineDriveFileRef } = get()
      previewOnlineDriveFileRef.current = fileList.find(file => file.id === id)
    },
    fileList: [],
    setFileList: (fileList: OnlineDriveFile[]) => set(() => ({
      fileList,
    })),
    bucket: '',
    setBucket: (bucket: string) => set(() => ({
      bucket,
    })),
    nextPageParameters: {},
    currentNextPageParametersRef: { current: {} },
    setNextPageParameters: (nextPageParameters: Record<string, any>) => set(() => ({
      nextPageParameters,
    })),
    isTruncated: { current: false },
    previewOnlineDriveFileRef: { current: undefined },
  })
}
