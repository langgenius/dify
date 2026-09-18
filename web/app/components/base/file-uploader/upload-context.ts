import { createContext, use } from 'react'

export const FileUploadContext = createContext<{
  localUploadUrl?: string
  remoteUploadUrl?: string
}>({})

export function useFileUploadContext() {
  return use(FileUploadContext)
}
