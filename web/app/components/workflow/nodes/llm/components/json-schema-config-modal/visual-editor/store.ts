import type { SchemaRoot } from '../../../types'
import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import { VisualEditorContext } from './context'

type VisualEditorStore = {
  hoveringProperty: string | null
  setHoveringProperty: (propertyPath: string | null) => void
  isAddingNewField: boolean
  setIsAddingNewField: (isAdding: boolean) => void
  advancedEditing: boolean
  setAdvancedEditing: (isEditing: boolean) => void
  backupSchema: SchemaRoot | null
  setBackupSchema: (schema: SchemaRoot | null) => void
}

export const createVisualEditorStore = () => createStore<VisualEditorStore>(set => ({
  hoveringProperty: null,
  setHoveringProperty: (propertyPath: string | null) => set({ hoveringProperty: propertyPath }),
  isAddingNewField: false,
  setIsAddingNewField: (isAdding: boolean) => set({ isAddingNewField: isAdding }),
  advancedEditing: false,
  setAdvancedEditing: (isEditing: boolean) => set({ advancedEditing: isEditing }),
  backupSchema: null,
  setBackupSchema: (schema: SchemaRoot | null) => set({ backupSchema: schema }),
}))

export const useVisualEditorStore = <T>(selector: (state: VisualEditorStore) => T): T => {
  const store = useContext(VisualEditorContext)
  if (!store)
    throw new Error('Missing VisualEditorContext.Provider in the tree')

  return useStore(store, selector)
}
