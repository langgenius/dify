import { createContext, use } from 'react'

export const FileUploadContext = createContext<{ uploadUrl?: string }>({})

export function useFileUploadContext() {
  return use(FileUploadContext)
}
