'use client'

import type { SkillEditorStore } from './store'
import { useRef } from 'react'
import { createSkillEditorStore, SkillEditorContext } from './store'

type SkillEditorProviderProps = {
  children: React.ReactNode
}

export function SkillEditorProvider({ children }: SkillEditorProviderProps): React.ReactElement {
  const storeRef = useRef<SkillEditorStore | undefined>(undefined)

  if (!storeRef.current)
    storeRef.current = createSkillEditorStore()

  return (
    <SkillEditorContext.Provider value={storeRef.current}>
      {children}
    </SkillEditorContext.Provider>
  )
}
