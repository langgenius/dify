import type { FallbackEntry, SaveFileOptions, SaveResult } from './use-skill-save-manager'
import * as React from 'react'

type SkillSaveContextValue = {
  saveFile: (fileId: string, options?: SaveFileOptions) => Promise<SaveResult>
  saveAllDirty: () => void
  registerFallback: (fileId: string, entry: FallbackEntry) => void
  unregisterFallback: (fileId: string) => void
}

export const SkillSaveContext = React.createContext<SkillSaveContextValue | null>(null)

export const useSkillSaveManager = () => {
  const context = React.useContext(SkillSaveContext)
  if (!context)
    throw new Error('Missing SkillSaveProvider in the tree')

  return context
}
