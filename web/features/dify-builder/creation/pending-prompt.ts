import { atom } from 'jotai'

// The prompt crosses only this client navigation and belongs to the app just created.
export const pendingBuilderPromptAtom = atom<{ appId: string; prompt: string } | null>(null)
