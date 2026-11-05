import type { fileUpload } from './utils'
import type { uploadPublicRemoteFileInfo } from '@/service/common'
import { createContext, use } from 'react'

/** The surface owns upload authorization; local failures use the supplied callbacks. */
export type FileUploadStrategy = {
  uploadLocal: (params: Parameters<typeof fileUpload>[0]) => void
  uploadRemote: (url: string) => ReturnType<typeof uploadPublicRemoteFileInfo>
}

export const FileUploadContext = createContext<{
  localUploadUrl?: string
  trialAppId?: string
  uploadStrategy?: FileUploadStrategy
}>({})

export function useFileUploadContext() {
  return use(FileUploadContext)
}
