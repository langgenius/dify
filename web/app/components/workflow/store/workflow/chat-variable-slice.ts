import type { StateCreator } from 'zustand'
import type { ConversationVariable } from '@/app/components/workflow/types'

export type ChatVariableSliceShape = {
  showChatVariablePanel: boolean
  setShowChatVariablePanel: (showChatVariablePanel: boolean) => void
  showGlobalVariablePanel: boolean
  setShowGlobalVariablePanel: (showGlobalVariablePanel: boolean) => void
  conversationVariables: ConversationVariable[]
  setConversationVariables: (conversationVariables: ConversationVariable[]) => void
}

export const createChatVariableSlice: StateCreator<ChatVariableSliceShape> = (set) => {
  const hideAllPanel = {
    showDebugAndPreviewPanel: false,
    showEnvPanel: false,
    showChatVariablePanel: false,
    showGlobalVariablePanel: false,
  }

  return ({
    showChatVariablePanel: false,
    setShowChatVariablePanel: showChatVariablePanel => set(() => ({ showChatVariablePanel })),
    showGlobalVariablePanel: false,
    setShowGlobalVariablePanel: showGlobalVariablePanel => set(() => {
      if (showGlobalVariablePanel)
        return { ...hideAllPanel, showGlobalVariablePanel: true }
      else
        return { showGlobalVariablePanel: false }
    }),
    conversationVariables: [],
    setConversationVariables: conversationVariables => set(() => ({ conversationVariables })),
  })
}
