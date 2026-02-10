import type { ReactNode } from 'react'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type ToolBlockContextValue = {
  metadata?: Record<string, unknown>
  onMetadataChange?: (metadata: Record<string, unknown>) => void
  useModal?: boolean
  disableToolBlocks?: boolean
  nodeId?: string
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

type ToolBlockStoreState = {
  context: ToolBlockContextValue | null
  setContext: (context: ToolBlockContextValue | null) => void
}

const createToolBlockStore = (initialContext: ToolBlockContextValue | null) => createStore<ToolBlockStoreState>(set => ({
  context: initialContext,
  setContext: context => set({ context }),
}))

type ToolBlockStore = ReturnType<typeof createToolBlockStore>

const defaultToolBlockStore = createToolBlockStore(null)

const ToolBlockStoreContext = createContext<ToolBlockStore | null>(null)

type ToolBlockContextProviderProps = {
  value?: ToolBlockContextValue | null
  children: ReactNode
}

export const ToolBlockContextProvider = ({ value, children }: ToolBlockContextProviderProps) => {
  const storeRef = useRef<ToolBlockStore>(null)
  if (!storeRef.current)
    storeRef.current = createToolBlockStore(value ?? null)

  useEffect(() => {
    storeRef.current?.getState().setContext(value ?? null)
  }, [value])

  return (
    <ToolBlockStoreContext.Provider value={storeRef.current}>
      {children}
    </ToolBlockStoreContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToolBlockContext = <T = ToolBlockContextValue | null,>(
  selector?: (context: ToolBlockContextValue | null) => T,
) => {
  const store = useContext(ToolBlockStoreContext) ?? defaultToolBlockStore
  const selectContext = useCallback(
    (state: ToolBlockStoreState) => {
      if (selector)
        return selector(state.context)
      return state.context as T
    },
    [selector],
  )

  return useStore(store, selectContext)
}
