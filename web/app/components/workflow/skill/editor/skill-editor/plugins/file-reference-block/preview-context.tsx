import * as React from 'react'

type FilePreviewContextValue = {
  enabled: boolean
}

const FilePreviewContext = React.createContext<FilePreviewContextValue>({ enabled: false })

export const FilePreviewContextProvider = FilePreviewContext.Provider

// eslint-disable-next-line react-refresh/only-export-components
export const useFilePreviewContext = () => {
  return React.useContext(FilePreviewContext)
}
