'use client'
import type { WorkflowGeneratorIntent, WorkflowGeneratorMode } from './types'
import { create } from 'zustand'

type WorkflowGeneratorStore = {
  isOpen: boolean
  mode: WorkflowGeneratorMode
  /** `create` = build a new app; `refine` = amend the current Studio draft. */
  intent: WorkflowGeneratorIntent
  currentAppId: string | null
  currentAppMode: WorkflowGeneratorMode | null
  openGenerator: (params: {
    mode: WorkflowGeneratorMode
    intent?: WorkflowGeneratorIntent
    currentAppId?: string | null
    currentAppMode?: WorkflowGeneratorMode | null
  }) => void
  closeGenerator: () => void
}

/**
 * Wipe the session-storage entries ``useGenGraph`` keeps for the new-app
 * (no ``currentAppId``) bucket. We do this every time ``/create`` opens so
 * the panel starts on the empty placeholder instead of showing whatever
 * graph the previous /create session produced — those generations belong
 * to a different intent and confusingly leak across opens.
 *
 * Studio-refine sessions (``currentAppId`` set) keep their history so the
 * user can close and reopen the generator from the same Studio without losing
 * the versions they were comparing.
 */
const resetNewAppHistory = (mode: WorkflowGeneratorMode) => {
  if (typeof window === 'undefined')
    return
  const storageKey = `${mode}-new`
  try {
    sessionStorage.removeItem(`workflow-gen-${storageKey}-versions`)
    sessionStorage.removeItem(`workflow-gen-${storageKey}-version-index`)
  }
  catch {
    // sessionStorage can throw in privacy-restricted contexts; the stale
    // state will still flush on tab close, so swallowing here is fine.
  }
}

export const useWorkflowGeneratorStore = create<WorkflowGeneratorStore>(set => ({
  isOpen: false,
  mode: 'workflow',
  intent: 'create',
  currentAppId: null,
  currentAppMode: null,
  openGenerator: ({ mode, intent = 'create', currentAppId = null, currentAppMode = null }) => {
    if (!currentAppId)
      resetNewAppHistory(mode)
    set({ isOpen: true, mode, intent, currentAppId, currentAppMode })
  },
  closeGenerator: () => set({ isOpen: false }),
}))
