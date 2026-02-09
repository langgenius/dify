import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type FilePreviewContextValue = {
  enabled: boolean
}

type FilePreviewStoreState = {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

const createFilePreviewStore = (enabled: boolean) => createStore<FilePreviewStoreState>(set => ({
  enabled,
  setEnabled: nextEnabled => set({ enabled: nextEnabled }),
}))

type FilePreviewStore = ReturnType<typeof createFilePreviewStore>

const defaultFilePreviewStore = createFilePreviewStore(false)

const FilePreviewStoreContext = createContext<FilePreviewStore | null>(null)

type FilePreviewContextProviderProps = {
  value?: FilePreviewContextValue
  children: ReactNode
}

export const FilePreviewContextProvider = ({ value, children }: FilePreviewContextProviderProps) => {
  const storeRef = useRef<FilePreviewStore>(null)
  if (!storeRef.current)
    storeRef.current = createFilePreviewStore(value?.enabled ?? false)

  useEffect(() => {
    storeRef.current?.getState().setEnabled(value?.enabled ?? false)
  }, [value?.enabled])

  return (
    <FilePreviewStoreContext.Provider value={storeRef.current}>
      {children}
    </FilePreviewStoreContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useFilePreviewContext = <T = FilePreviewContextValue>(
  selector?: (context: FilePreviewContextValue) => T,
) => {
  const store = useContext(FilePreviewStoreContext) ?? defaultFilePreviewStore
  const selectContext = useCallback(
    (state: FilePreviewStoreState) => {
      if (selector)
        return selector({ enabled: state.enabled })
      return { enabled: state.enabled } as T
    },
    [selector],
  )

  return useStore(store, selectContext)
}
