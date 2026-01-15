'use client'

import type { SkillEditorStore } from './store'
import {
  useEffect,
  useRef,
} from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  createSkillEditorStore,
  SkillEditorContext,
} from './store'

/**
 * SkillEditorProvider
 *
 * Provides the SkillEditor store to all child components.
 * The store is created once per mount and persists across view switches.
 * When appId changes, the store is reset.
 */
export type SkillEditorProviderProps = {
  children: React.ReactNode
}

export const SkillEditorProvider = ({ children }: SkillEditorProviderProps) => {
  const storeRef = useRef<SkillEditorStore | undefined>(undefined)
  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id
  const prevAppIdRef = useRef<string | undefined>(undefined)

  // Create store on first render (pattern recommended by React)
  if (storeRef.current === null || storeRef.current === undefined)
    storeRef.current = createSkillEditorStore()

  // Reset store when appId changes
  useEffect(() => {
    if (prevAppIdRef.current !== undefined && prevAppIdRef.current !== appId) {
      // appId changed, reset the store
      storeRef.current?.getState().reset()
    }
    prevAppIdRef.current = appId
  }, [appId])

  return (
    <SkillEditorContext.Provider value={storeRef.current}>
      {children}
    </SkillEditorContext.Provider>
  )
}

// Re-export for convenience
export { SkillEditorContext } from './store'
