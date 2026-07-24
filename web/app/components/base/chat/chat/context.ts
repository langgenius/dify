'use client'

import type { ChatProps } from './index'
import { createContext, useContext } from 'use-context-selector'

export type ChatContextValue = Pick<ChatProps, 'config'
  | 'isResponding'
  | 'chatList'
  | 'showPromptLog'
  | 'questionIcon'
  | 'answerIcon'
  | 'onSend'
  | 'onRegenerate'
  | 'onAnnotationEdited'
  | 'onAnnotationAdded'
  | 'onAnnotationRemoved'
  | 'disableFeedback'
  | 'onFeedback'
  | 'getHumanInputNodeData'> & {
    readonly?: boolean
  }

export const ChatContext = createContext<ChatContextValue>({
  chatList: [],
  readonly: false,
})

export const useChatContext = () => useContext(ChatContext)

export default ChatContext
