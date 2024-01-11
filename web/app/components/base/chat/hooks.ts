import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { produce } from 'immer'
import { useGetState } from 'ahooks'
import type {
  ChatConfig,
  ChatItem,
} from './types'
import { useToastContext } from '@/app/components/base/toast'
import { ssePost } from '@/service/base'

export const useChat = (config: ChatConfig, prevChatList?: ChatItem[]) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [isResponsing, setIsResponsing] = useState(false)
  const [chatList, setChatList, getChatList] = useGetState<ChatItem[]>(prevChatList || [])
  const [abortController, setAbortController] = useState<AbortController | null>(null)

  const handleSend = useCallback(async (url: string, data: any) => {
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    // qustion
    const questionId = `question-${Date.now()}`
    const questionItem = {
      id: questionId,
      content: data.query,
      isAnswer: false,
      message_files: data.files,
    }

    const placeholderAnswerId = `answer-placeholder-${Date.now()}`
    const placeholderAnswerItem = {
      id: placeholderAnswerId,
      content: '',
      isAnswer: true,
    }

    const newList = [...getChatList(), questionItem, placeholderAnswerItem]
    setChatList(newList)

    // answer
    const responseItem: ChatItem = {
      id: `${Date.now()}`,
      content: '',
      isAnswer: true,
    }

    setIsResponsing(true)
    ssePost(
      url,
      {
        body: {
          ...data,
          response_mode: 'streaming',
        },
      },
      {
        getAbortController: (abortController) => {
          setAbortController(abortController)
        },
        onData: (message: string, isFirstMessage: boolean, { conversationId: newConversationId, messageId, taskId }: any) => {
          responseItem.content = responseItem.content + message

          // closesure new list is outdated.
          const newListWithAnswer = produce(
            getChatList().filter(item => item.id !== responseItem.id && item.id !== placeholderAnswerId),
            (draft) => {
              if (!draft.find(item => item.id === questionId))
                draft.push({ ...questionItem })

              draft.push({ ...responseItem })
            })
          setChatList(newListWithAnswer)
        },
        async onCompleted(hasError?: boolean) {
          setIsResponsing(false)
        },
        onMessageEnd: (messageEnd) => {

        },
        onMessageReplace: (messageReplace) => {
          responseItem.content = messageReplace.answer
        },
        onError() {
          setIsResponsing(false)
          // role back placeholder answer
          setChatList(produce(getChatList(), (draft) => {
            draft.splice(draft.findIndex(item => item.id === placeholderAnswerId), 1)
          }))
        },
      })
    return true
  }, [])

  return {
    chatList,
    getChatList,
    setChatList,
    isResponsing,
    setIsResponsing,
    handleSend,
  }
}
