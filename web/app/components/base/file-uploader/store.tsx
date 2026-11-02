import type { FileEntity } from './types'
import { createContext, use, useEffect, useState } from 'react'
import { create, useStore as useZustandStore } from 'zustand'

type Shape = {
  isActive: boolean
  files: FileEntity[]
  setFiles: (files: FileEntity[]) => void
}

export const createFileStore = (
  value: FileEntity[] = [],
  onChange?: (files: FileEntity[]) => void,
) => {
  return create<Shape>((set, get) => ({
    isActive: true,
    files: value ? [...value] : [],
    setFiles: (files) => {
      if (!get().isActive) return
      set({ files })
      onChange?.(files)
    },
  }))
}

type FileStore = ReturnType<typeof createFileStore>
export const FileContext = createContext<FileStore | null>(null)

export function useStore<T>(selector: (state: Shape) => T): T {
  const store = use(FileContext)
  if (!store) throw new Error('Missing FileContext.Provider in the tree')

  return useZustandStore(store, selector)
}

export const useFileStore = () => {
  return use(FileContext)!
}

type FileProviderProps = {
  children: React.ReactNode
  value?: FileEntity[]
  onChange?: (files: FileEntity[]) => void
}
export const FileContextProvider = ({ children, value, onChange }: FileProviderProps) => {
  const [store] = useState(() => createFileStore(value, onChange))

  useEffect(() => {
    store.setState({ isActive: true })
    return () => {
      store.setState({ isActive: false })
    }
  }, [store])

  return <FileContext.Provider value={store}>{children}</FileContext.Provider>
}
