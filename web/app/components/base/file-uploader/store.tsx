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
import type {
  FileEntity,
} from './types'

type Shape = {
  files: FileEntity[]
  setFiles: (files: FileEntity[]) => void
}

export const createFileStore = (
  value: FileEntity[] = [],
) => {
  return create<Shape>(set => ({
    files: value ? [...value] : [],
    setFiles: (files) => {
      set({ files })
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
  const onChangeRef = useRef<FileProviderProps['onChange']>(onChange)
  const isSyncingRef = useRef(false)

  if (!storeRef.current)
    storeRef.current = createFileStore(value)

  // keep latest onChange
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // subscribe to store changes and call latest onChange
  useEffect(() => {
    const store = storeRef.current!
    const unsubscribe = store.subscribe((state: Shape) => {
      if (isSyncingRef.current) return
      onChangeRef.current?.(state.files)
    })
    return unsubscribe
  }, [])

  // sync external value into internal store when value changes
  useEffect(() => {
    const store = storeRef.current!
    const nextFiles = value ? [...value] : []
    isSyncingRef.current = true
    store.setState({ files: nextFiles })
    isSyncingRef.current = false
  }, [value])

  return (
    <FileContext.Provider value={storeRef.current}>
      {children}
    </FileContext.Provider>
  )
}
