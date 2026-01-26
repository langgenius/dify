import type { StateCreator } from 'zustand'
import type { ChatItemInTree } from '@/app/components/base/chat/types'

type ChatPreviewState = {
  chatTree: ChatItemInTree[]
  targetMessageId: string | undefined
  suggestedQuestions: string[]
  conversationId: string
  isResponding: boolean
}

type ChatPreviewActions = {
  setChatTree: (chatTree: ChatItemInTree[]) => void
  updateChatTree: (updater: (chatTree: ChatItemInTree[]) => ChatItemInTree[]) => void
  setTargetMessageId: (messageId: string | undefined) => void
  setSuggestedQuestions: (questions: string[]) => void
  setConversationId: (conversationId: string) => void
  setIsResponding: (isResponding: boolean) => void
  resetChatPreview: () => void
}

export type ChatPreviewSliceShape = ChatPreviewState & ChatPreviewActions

const initialState: ChatPreviewState = {
  chatTree: [],
  targetMessageId: undefined,
  suggestedQuestions: [],
  conversationId: '',
  isResponding: false,
}

export const createChatPreviewSlice: StateCreator<ChatPreviewSliceShape> = set => ({
  ...initialState,

  setChatTree: chatTree => set({ chatTree }),

  updateChatTree: updater => set((state) => {
    const nextChatTree = updater(state.chatTree)
    if (nextChatTree === state.chatTree)
      return state
    return { chatTree: nextChatTree }
  }),

  setTargetMessageId: targetMessageId => set({ targetMessageId }),

  setSuggestedQuestions: suggestedQuestions => set({ suggestedQuestions }),

  setConversationId: conversationId => set({ conversationId }),

  setIsResponding: isResponding => set({ isResponding }),

  resetChatPreview: () => set(initialState),
})
