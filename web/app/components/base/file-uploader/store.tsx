import {
  useRef,
} from 'react'
import {
  create,
  useStore as useZustandStore,
} from 'zustand'
import type {
  FileEntity,
} from './types'
import { createCtx } from '@/utils/context'

type Shape = {
  files: FileEntity[]
  setFiles: (files: FileEntity[]) => void
}

export const createFileStore = (
  value: FileEntity[] = [],
  onChange?: (files: FileEntity[]) => void,
) => {
  return create<Shape>(set => ({
    files: [...value],
    setFiles: (files) => {
      set({ files })
      onChange?.(files)
    },
  }))
}

type FileStore = ReturnType<typeof createFileStore>
export const [, useFileStore, FileContext] = createCtx<FileStore>()

export function useStore<T>(selector: (state: Shape) => T): T {
  const store = useFileStore()
  return useZustandStore(store, selector)
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
  const storeRef = useRef<FileStore>()

  if (!storeRef.current)
    storeRef.current = createFileStore(value, onChange)

  return (
    <FileContext.Provider value={storeRef.current}>
      {children}
    </FileContext.Provider>
  )
}
