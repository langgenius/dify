import * as React from 'react'

type FilePreviewContextValue = {
  enabled: boolean
}

const FilePreviewContext = React.createContext<FilePreviewContextValue>({ enabled: false })

export const FilePreviewContextProvider = FilePreviewContext.Provider

export const useFilePreviewContext = () => {
  return React.useContext(FilePreviewContext)
}
