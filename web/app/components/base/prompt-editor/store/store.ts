import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import { PromptEditorContext } from './provider'

type PromptEditorStoreProps = {
  instanceId?: string
}
type PromptEditorStore = {
  instanceId?: string
}

export const createPromptEditorStore = ({ instanceId }: PromptEditorStoreProps) => {
  return createStore<PromptEditorStore>(() => ({
    instanceId,
  }))
}

export const usePromptEditorStore = <T>(selector: (state: PromptEditorStore) => T): T => {
  const store = useContext(PromptEditorContext)
  if (!store)
    throw new Error('Missing PromptEditorContext.Provider in the tree')

  return useStore(store, selector)
}
