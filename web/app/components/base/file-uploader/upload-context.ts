import { createContext, use } from 'react'

export const FileUploadContext = createContext<{
  localUploadUrl?: string
  trialAppId?: string
}>({})

export function useFileUploadContext() {
  return use(FileUploadContext)
}
