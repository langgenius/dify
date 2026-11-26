import type { fileUpload } from './utils'
import { createContext, use } from 'react'

/** The surface owns upload authorization; local failures use the supplied callbacks. */
export type FileUploadStrategy = {
  uploadLocal: (params: Parameters<typeof fileUpload>[0]) => void
  uploadRemote: (url: string) => Promise<RemoteFileUploadResult>
}

type RemoteFileUploadResult = {
  id: string
  name: string
  size: number
  mime_type: string | null
  url: string | null
}

export const FileUploadContext = createContext<{
  trialAppId?: string
  uploadStrategy?: FileUploadStrategy
}>({})

export function useFileUploadContext() {
  return use(FileUploadContext)
}
