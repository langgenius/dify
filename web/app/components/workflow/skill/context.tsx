'use client'

import {
  useEffect,
  useMemo,
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
  // Create store once using useMemo (stable across re-renders)
  const store = useMemo(() => createSkillEditorStore(), [])

  const appDetail = useAppStore(s => s.appDetail)
  const appId = appDetail?.id
  const prevAppIdRef = useRef<string | undefined>(undefined)

  // Reset store when appId changes
  useEffect(() => {
    if (prevAppIdRef.current !== undefined && prevAppIdRef.current !== appId)
      store.getState().reset()

    prevAppIdRef.current = appId
  }, [appId, store])

  return (
    <SkillEditorContext.Provider value={store}>
      {children}
    </SkillEditorContext.Provider>
  )
}
