import type { ChatVariableSliceShape } from '../chat-variable-slice'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { createStore } from 'zustand/vanilla'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { createChatVariableSlice } from '../chat-variable-slice'

type ChatPanelState = ChatVariableSliceShape & {
  showDebugAndPreviewPanel?: boolean
  showEnvPanel?: boolean
}

describe('createChatVariableSlice', () => {
  it('toggles chat and global variable panels while clearing the other overlay states', () => {
    const store = createStore(createChatVariableSlice)

    store.getState().setShowChatVariablePanel(true)
    const chatState = store.getState() as ChatPanelState
    expect(chatState).toMatchObject({
      showChatVariablePanel: true,
      showGlobalVariablePanel: false,
      showEnvPanel: false,
      showDebugAndPreviewPanel: false,
    })

    store.getState().setShowGlobalVariablePanel(true)
    const globalState = store.getState() as ChatPanelState
    expect(globalState).toMatchObject({
      showChatVariablePanel: false,
      showGlobalVariablePanel: true,
      showEnvPanel: false,
      showDebugAndPreviewPanel: false,
    })

    store.getState().setShowGlobalVariablePanel(false)
    expect(store.getState().showGlobalVariablePanel).toBe(false)
  })

  it('stores conversation variables', () => {
    const store = createStore(createChatVariableSlice)
    const conversationVariables: ConversationVariable[] = [
      {
        id: 'conversation-id',
        name: 'Conversation ID',
        value_type: ChatVarType.String,
        value: 'abc',
        description: 'Current conversation id',
      },
    ]

    store.getState().setConversationVariables(conversationVariables)

    expect(store.getState().conversationVariables).toEqual(conversationVariables)
  })
})
