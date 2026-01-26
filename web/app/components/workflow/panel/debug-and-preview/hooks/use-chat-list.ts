import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { ChatItemInTree, Inputs } from '@/app/components/base/chat/types'
import { useCallback, useMemo } from 'react'
import { processOpeningStatement } from '@/app/components/base/chat/chat/utils'
import { getThreadMessages } from '@/app/components/base/chat/utils'

type UseChatListParams = {
  chatTree: ChatItemInTree[]
  targetMessageId: string | undefined
  config: {
    opening_statement?: string
    suggested_questions?: string[]
  } | undefined
  formSettings?: {
    inputs: Inputs
    inputsForm: InputForm[]
  }
}

export function useChatList({
  chatTree,
  targetMessageId,
  config,
  formSettings,
}: UseChatListParams) {
  const threadMessages = useMemo(
    () => getThreadMessages(chatTree, targetMessageId),
    [chatTree, targetMessageId],
  )

  const getIntroduction = useCallback((str: string) => {
    return processOpeningStatement(str, formSettings?.inputs || {}, formSettings?.inputsForm || [])
  }, [formSettings?.inputs, formSettings?.inputsForm])

  const chatList = useMemo(() => {
    const ret = [...threadMessages]
    if (config?.opening_statement) {
      const index = threadMessages.findIndex(item => item.isOpeningStatement)

      if (index > -1) {
        ret[index] = {
          ...ret[index],
          content: getIntroduction(config.opening_statement),
          suggestedQuestions: config.suggested_questions?.map((item: string) => getIntroduction(item)),
        }
      }
      else {
        ret.unshift({
          id: `${Date.now()}`,
          content: getIntroduction(config.opening_statement),
          isAnswer: true,
          isOpeningStatement: true,
          suggestedQuestions: config.suggested_questions?.map((item: string) => getIntroduction(item)),
        })
      }
    }
    return ret
  }, [threadMessages, config?.opening_statement, getIntroduction, config?.suggested_questions])

  return {
    threadMessages,
    chatList,
    getIntroduction,
  }
}
