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
  files: FileEntity[]
  setFiles: (files: FileEntity[]) => void
}

export const createFileStore = (
  value: FileEntity[] = [],
  onChange?: (files: FileEntity[]) => void,
) => {
  return create<Shape>(set => ({
    files: value ? [...value] : [],
    setFiles: (files) => {
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

  // 当外部传入的value发生变化时，同步更新store中的files
  useEffect(() => {
    if (storeRef.current && value) {
      // 检查当前存储的文件和传入的值是否不同
      const currentFiles = storeRef.current.getState().files
      const isDifferent = currentFiles.length !== value.length
        || currentFiles.some((file, index) => file.id !== value[index]?.id)

      if (isDifferent)
        storeRef.current.getState().setFiles(value)
    }
    else if (storeRef.current && !value) {
      // 如果value为空，清空store中的文件
      storeRef.current.getState().setFiles([])
    }
  }, [value])

  return (
    <FileContext.Provider value={storeRef.current}>
      {children}
    </FileContext.Provider>
  )
}
