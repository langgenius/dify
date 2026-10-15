import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { ChatItem } from '@/app/components/base/chat/types'
import { RiCloseLine } from '@remixicon/react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { memo, useMemo, useState } from 'react'
import Chat from '@/app/components/base/chat/chat'
import { buildChatItemTree, getThreadMessages } from '@/app/components/base/chat/utils'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { useWorkflowRun } from '../../hooks/use-workflow-run'
import { useStore, useWorkflowStore } from '../../store'
import { formatWorkflowRunIdentifier } from '../../utils'
import UserInput from './user-input'

function getFormattedChatList(messages: any[]) {
  const res: ChatItem[] = []
  messages.forEach((item: any) => {
    const questionFiles =
      item.message_files?.filter((file: any) => file.belongs_to === 'user') || []
    res.push({
      id: `question-${item.id}`,
      content: item.query,
      isAnswer: false,
      message_files: getProcessedFilesFromResponse(
        questionFiles.map((item: any) => ({ ...item, related_id: item.id })),
      ),
      parentMessageId: item.parent_message_id || undefined,
    })
    const answerFiles =
      item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || []
    res.push({
      id: item.id,
      content: item.answer,
      feedback: item.feedback,
      isAnswer: true,
      citation: item.metadata?.retriever_resources,
      reasoningContent: item.metadata?.reasoning,
      reasoningFinished: true,
      message_files: getProcessedFilesFromResponse(
        answerFiles.map((item: any) => ({ ...item, related_id: item.id })),
      ),
      workflow_run_id: item.workflow_run_id,
      parentMessageId: `question-${item.id}`,
    })
  })
  return res
}

const ChatRecord = () => {
  const { appId } = useParams<{ appId: string }>()
  const [selectedMessage, setSelectedMessage] = useState<{
    appId: string
    conversationId: string | undefined
    messageId: string
  }>()
  const workflowStore = useWorkflowStore()
  const setMessageLogItem = useStore((state) => state.setMessageLogItem)
  const { handleLoadBackupDraft } = useWorkflowRun()
  const historyWorkflowData = useStore((s) => s.historyWorkflowData)
  const currentConversationID = historyWorkflowData?.conversation_id

  const { data, isPending } = useQuery(
    consoleQuery.apps.byAppId.chatMessages.get.queryOptions({
      input: currentConversationID
        ? { params: { app_id: appId }, query: { conversation_id: currentConversationID } }
        : skipToken,
      retry: false,
      refetchOnWindowFocus: false,
    }),
  )
  const chatItems = useMemo(() => getFormattedChatList(data?.data ?? []), [data])
  const chatItemTree = useMemo(() => buildChatItemTree(chatItems), [chatItems])
  const selectedMessageId =
    selectedMessage?.appId === appId && selectedMessage.conversationId === currentConversationID
      ? selectedMessage.messageId
      : chatItems.at(-1)?.id
  const threadChatItems: IChatItem[] = getThreadMessages(chatItemTree, selectedMessageId)

  return (
    <div
      className="flex h-full w-105 flex-col rounded-l-2xl border border-components-panel-border bg-chatbot-bg shadow-xl"
      // style={{
      //   background: 'linear-gradient(156deg, rgba(242, 244, 247, 0.80) 0%, rgba(242, 244, 247, 0.00) 99.43%), var(--white, #FFF)',
      // }}
    >
      {isPending && (
        <div className="flex h-full items-center justify-center">
          <LoadingPlaceholder />
        </div>
      )}
      {!isPending && (
        <>
          <div className="flex shrink-0 items-center justify-between p-4 pb-1 text-base font-semibold text-text-primary">
            {`TEST CHAT${formatWorkflowRunIdentifier(historyWorkflowData?.finished_at)}`}
            <div
              className="flex size-6 cursor-pointer items-center justify-center"
              onClick={() => {
                handleLoadBackupDraft()
                workflowStore.setState({
                  historyWorkflowData: undefined,
                  messageLogItem: undefined,
                })
              }}
            >
              <RiCloseLine className="size-4 text-text-tertiary" />
            </div>
          </div>
          <div className="h-0 grow">
            <Chat
              config={
                {
                  supportCitationHitInfo: true,
                  questionEditEnable: false,
                } as any
              }
              chatList={threadChatItems}
              chatContainerClassName="px-3"
              chatContainerInnerClassName="pt-6 w-full max-w-full mx-auto"
              chatFooterClassName="px-4 rounded-b-2xl"
              chatFooterInnerClassName="pb-4 w-full max-w-full mx-auto"
              chatNode={<UserInput />}
              noChatInput
              allToolIcons={{}}
              onOpenLog={setMessageLogItem}
              canOpenLog={(item) => !!item.workflow_run_id}
              switchSibling={(messageId) =>
                setSelectedMessage({ appId, conversationId: currentConversationID, messageId })
              }
              noSpacing
              chatAnswerContainerInner="pr-2!"
            />
          </div>
        </>
      )}
    </div>
  )
}

export default memo(ChatRecord)
