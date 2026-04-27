import type {
  FileEntity,
} from './types'
import { createStore } from 'zustand/vanilla'
import { createStoreContext, useContextStore, useContextStoreApi, useStoreRef } from '@/stores/create-context-store'

type Shape = {
  files: FileEntity[]
  setFiles: (files: FileEntity[]) => void
}

const FileContext = createStoreContext<Shape>('File')

export const createFileStore = (
  value: FileEntity[] = [],
  onChange?: (files: FileEntity[]) => void,
) => {
  return createStore<Shape>(set => ({
    files: value ? [...value] : [],
    setFiles: (files) => {
      set({ files })
      onChange?.(files)
    },
  }))
}

export function useFileStoreWithSelector<T>(selector: (state: Shape) => T): T {
  return useContextStore(FileContext, selector)
}

export function useFileStore() {
  return useContextStoreApi(FileContext)
}

type FileProviderProps = {
  children: React.ReactNode
  value?: FileEntity[]
  onChange?: (files: FileEntity[]) => void
}
export function FileContextProvider({
  children,
  value = [],
  onChange,
}: FileProviderProps) {
  const store = useStoreRef(() => createFileStore(value, onChange))

  return (
    <FileContext.Provider value={store}>
      {children}
    </FileContext.Provider>
  )
}
