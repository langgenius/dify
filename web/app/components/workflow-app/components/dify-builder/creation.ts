import { atom } from 'jotai'

// A one-shot handoff across client navigation, kept outside the editor's session scope.
export const difyBuilderPendingCreationAtom = atom<{
  appId: string
  prompt: string
} | null>(null)
