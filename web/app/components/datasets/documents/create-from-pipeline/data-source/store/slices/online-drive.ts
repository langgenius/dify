import type { StateCreator } from 'zustand'
import type { OnlineDriveFile } from '@/models/pipeline'

export type OnlineDriveSliceShape = {
  breadcrumbs: string[]
  setBreadcrumbs: (breadcrumbs: string[]) => void
  prefix: string[]
  setPrefix: (prefix: string[]) => void
  keywords: string
  setKeywords: (keywords: string) => void
  selectedFileIds: string[]
  setSelectedFileIds: (selectedFileIds: string[]) => void
  onlineDriveFileList: OnlineDriveFile[]
  setOnlineDriveFileList: (onlineDriveFileList: OnlineDriveFile[]) => void
  bucket: string
  setBucket: (bucket: string) => void
  nextPageParameters: Record<string, any>
  currentNextPageParametersRef: React.RefObject<Record<string, any>>
  setNextPageParameters: (nextPageParameters: Record<string, any>) => void
  isTruncated: React.RefObject<boolean>
  previewOnlineDriveFileRef: React.RefObject<OnlineDriveFile | undefined>
  hasBucket: boolean
  setHasBucket: (hasBucket: boolean) => void
}

export const createOnlineDriveSlice: StateCreator<OnlineDriveSliceShape> = (set, get) => {
  return ({
    breadcrumbs: [],
    setBreadcrumbs: (breadcrumbs: string[]) => set(() => ({
      breadcrumbs,
    })),
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
      const { onlineDriveFileList, previewOnlineDriveFileRef } = get()
      previewOnlineDriveFileRef.current = onlineDriveFileList.find(file => file.id === id)
    },
    onlineDriveFileList: [],
    setOnlineDriveFileList: (onlineDriveFileList: OnlineDriveFile[]) => set(() => ({
      onlineDriveFileList,
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
    hasBucket: false,
    setHasBucket: (hasBucket: boolean) => set(() => ({
      hasBucket,
    })),
  })
}
