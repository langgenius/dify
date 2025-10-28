import {
  createContext,
  useContext,
  useRef,
} from 'react'
import { createVisualEditorStore } from './store'
import { useMitt } from '@/hooks/use-mitt'
import { noop } from 'lodash-es'

type VisualEditorStore = ReturnType<typeof createVisualEditorStore>

type VisualEditorContextType = VisualEditorStore | null

type VisualEditorProviderProps = {
  children: React.ReactNode
}

export const VisualEditorContext = createContext<VisualEditorContextType>(null)

export const VisualEditorContextProvider = ({ children }: VisualEditorProviderProps) => {
  const storeRef = useRef<VisualEditorStore | null>(null)

  if (!storeRef.current)
    storeRef.current = createVisualEditorStore()

  return (
    <VisualEditorContext.Provider value={storeRef.current}>
      {children}
    </VisualEditorContext.Provider>
  )
}

export const MittContext = createContext<ReturnType<typeof useMitt>>({
  emit: noop,
  useSubscribe: noop,
})

export const MittProvider = ({ children }: { children: React.ReactNode }) => {
  const mitt = useMitt()

  return (
    <MittContext.Provider value={mitt}>
      {children}
    </MittContext.Provider>
  )
}

export const useMittContext = () => {
  return useContext(MittContext)
}
