import {
  createContext,
  useContext,
  useRef,
} from 'react'
import {
  useStore as useZustandStore,
} from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { FileEntity } from './types'

type Shape = {
  files: FileEntity[]
  setFiles: (files: FileEntity[]) => void
}

export const createFileStore = () => {
  return createStore<Shape>(set => ({
    files: [],
    setFiles: files => set({ files }),
  }))
}

type FileStore = ReturnType<typeof createFileStore>
export const FileContext = createContext<FileStore | null>(null)

export function useStore<T>(selector: (state: Shape) => T): T {
  const store = useContext(FileContext)
  if (!store)
    throw new Error('Missing FileContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useFileStore = () => {
  return useContext(FileContext)!
}

type FileProviderProps = {
  children: React.ReactNode
}
export const FileContextProvider = ({ children }: FileProviderProps) => {
  const storeRef = useRef<FileStore>()

  if (!storeRef.current)
    storeRef.current = createFileStore()

  return (
    <FileContext.Provider value={storeRef.current}>
      {children}
    </FileContext.Provider>
  )
}
