import { createContext, useRef } from 'react'
import { createPromptEditorStore } from './store'

type PromptEditorStoreApi = ReturnType<typeof createPromptEditorStore>

type PromptEditorContextType = PromptEditorStoreApi | undefined

export const PromptEditorContext = createContext<PromptEditorContextType>(undefined)

type PromptEditorProviderProps = {
  instanceId?: string
  children: React.ReactNode
}

const PromptEditorProvider = ({
  instanceId,
  children,
}: PromptEditorProviderProps) => {
  const storeRef = useRef<PromptEditorStoreApi>(undefined)

  if (!storeRef.current)
    storeRef.current = createPromptEditorStore({ instanceId })

  return (
    <PromptEditorContext.Provider value={storeRef.current!}>
      {children}
    </PromptEditorContext.Provider>
  )
}

export default PromptEditorProvider
