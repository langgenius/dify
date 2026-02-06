import type { StateCreator } from 'zustand'
import type { ChatItemInTree } from '@/app/components/base/chat/types'

type ChatPreviewState = {
  chatTree: ChatItemInTree[]
  targetMessageId: string | undefined
  suggestedQuestions: string[]
  conversationId: string
  isResponding: boolean
  activeRunId: number
  activeTaskId: string
  hasStopResponded: boolean
  suggestedQuestionsAbortController: AbortController | null
  workflowEventsAbortController: AbortController | null
}

type ChatPreviewActions = {
  setChatTree: (chatTree: ChatItemInTree[]) => void
  updateChatTree: (updater: (chatTree: ChatItemInTree[]) => ChatItemInTree[]) => void
  setTargetMessageId: (messageId: string | undefined) => void
  setSuggestedQuestions: (questions: string[]) => void
  setConversationId: (conversationId: string) => void
  setIsResponding: (isResponding: boolean) => void
  setActiveTaskId: (taskId: string) => void
  setHasStopResponded: (hasStopResponded: boolean) => void
  setSuggestedQuestionsAbortController: (controller: AbortController | null) => void
  setWorkflowEventsAbortController: (controller: AbortController | null) => void
  startRun: () => number
  invalidateRun: () => number
  resetChatPreview: () => void
}

export type ChatPreviewSliceShape = ChatPreviewState & ChatPreviewActions

const initialState: ChatPreviewState = {
  chatTree: [],
  targetMessageId: undefined,
  suggestedQuestions: [],
  conversationId: '',
  isResponding: false,
  activeRunId: 0,
  activeTaskId: '',
  hasStopResponded: false,
  suggestedQuestionsAbortController: null,
  workflowEventsAbortController: null,
}

export const createChatPreviewSlice: StateCreator<ChatPreviewSliceShape> = (set, get) => ({
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

  setActiveTaskId: activeTaskId => set({ activeTaskId }),

  setHasStopResponded: hasStopResponded => set({ hasStopResponded }),

  setSuggestedQuestionsAbortController: suggestedQuestionsAbortController => set({ suggestedQuestionsAbortController }),

  setWorkflowEventsAbortController: workflowEventsAbortController => set({ workflowEventsAbortController }),

  startRun: () => {
    const activeRunId = get().activeRunId + 1
    set({
      activeRunId,
      activeTaskId: '',
      hasStopResponded: false,
      suggestedQuestionsAbortController: null,
      workflowEventsAbortController: null,
    })
    return activeRunId
  },

  invalidateRun: () => {
    const activeRunId = get().activeRunId + 1
    set({
      activeRunId,
      activeTaskId: '',
      suggestedQuestionsAbortController: null,
      workflowEventsAbortController: null,
    })
    return activeRunId
  },

  resetChatPreview: () => set(state => ({
    ...initialState,
    activeRunId: state.activeRunId + 1,
  })),
})
