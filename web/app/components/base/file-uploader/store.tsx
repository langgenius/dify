import type {
  FileEntity,
} from './types'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
} from 'react'
import {
  create,
  useStore as useZustandStore,
} from 'zustand'

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
      if (!get().isActive)
        return
      set({ files })
      onChange?.(files)
    },
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
  value?: FileEntity[]
  onChange?: (files: FileEntity[]) => void
}
export const FileContextProvider = ({
  children,
  value,
  onChange,
}: FileProviderProps) => {
  const storeRef = useRef<FileStore | undefined>(undefined)

  if (!storeRef.current)
    storeRef.current = createFileStore(value, onChange)

  const store = storeRef.current
  useEffect(() => {
    store.setState({ isActive: true })
    return () => {
      store.setState({ isActive: false })
    }
  }, [store])

  return (
    <FileContext.Provider value={storeRef.current}>
      {children}
    </FileContext.Provider>
  )
}
