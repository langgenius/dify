import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import type { SchemaRoot } from '../../types'
import { JsonSchemaConfigContext } from './context'

type JsonSchemaConfigStore = {
  hoveringProperty: string | ''
  setHoveringProperty: (propertyPath: string) => void
  isAddingNewField: boolean
  setIsAddingNewField: (isAdding: boolean) => void
  advancedEditing: boolean
  setAdvancedEditing: (isEditing: boolean) => void
  backupSchema: SchemaRoot | null
  setBackupSchema: (schema: SchemaRoot | null) => void
}

export const createJsonSchemaConfigStore = () => createStore<JsonSchemaConfigStore>(set => ({
  hoveringProperty: '',
  setHoveringProperty: (propertyPath: string) => set({ hoveringProperty: propertyPath }),
  isAddingNewField: false,
  setIsAddingNewField: (isAdding: boolean) => set({ isAddingNewField: isAdding }),
  advancedEditing: false,
  setAdvancedEditing: (isEditing: boolean) => set({ advancedEditing: isEditing }),
  backupSchema: null,
  setBackupSchema: (schema: SchemaRoot | null) => set({ backupSchema: schema }),
}))

export const useJsonSchemaConfigStore = <T>(selector: (state: JsonSchemaConfigStore) => T): T => {
  const store = useContext(JsonSchemaConfigContext)
  if (!store)
    throw new Error('Missing JsonSchemaConfigContext.Provider in the tree')

  return useStore(store, selector)
}
