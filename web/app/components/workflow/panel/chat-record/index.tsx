import {
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { RiCloseLine } from '@remixicon/react'
import {
  useStore,
  useWorkflowStore,
} from '../../store'
import { useWorkflowRun } from '../../hooks'
import UserInput from './user-input'
import Chat from '@/app/components/base/chat/chat'
import type { ChatItem, ChatItemInTree } from '@/app/components/base/chat/types'
import { fetchConversationMessages } from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { buildChatItemTree, getThreadMessages } from '@/app/components/base/chat/utils'

function getFormattedChatList(messages: any[]) {
  const res: ChatItem[] = []
  messages.forEach((item: any) => {
    const questionFiles = item.message_files?.filter((file: any) => file.belongs_to === 'user') || []
    res.push({
      id: `question-${item.id}`,
      content: item.query,
      isAnswer: false,
      message_files: getProcessedFilesFromResponse(questionFiles.map((item: any) => ({ ...item, related_id: item.id }))),
      parentMessageId: item.parent_message_id || undefined,
    })
    const answerFiles = item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || []
    res.push({
      id: item.id,
      content: item.answer,
      feedback: item.feedback,
      isAnswer: true,
      citation: item.metadata?.retriever_resources,
      message_files: getProcessedFilesFromResponse(answerFiles.map((item: any) => ({ ...item, related_id: item.id }))),
      workflow_run_id: item.workflow_run_id,
      parentMessageId: `question-${item.id}`,
    })
  })
  return res
}

const ChatRecord = () => {
  const [fetched, setFetched] = useState(false)
  const [chatItemTree, setChatItemTree] = useState<ChatItemInTree[]>([])
  const [threadChatItems, setThreadChatItems] = useState<IChatItem[]>([])
  const appDetail = useAppStore(s => s.appDetail)
  const workflowStore = useWorkflowStore()
  const { handleLoadBackupDraft } = useWorkflowRun()
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const currentConversationID = historyWorkflowData?.conversation_id

  const handleFetchConversationMessages = useCallback(async () => {
    if (appDetail && currentConversationID) {
      try {
        setFetched(false)
        const res = await fetchConversationMessages(appDetail.id, currentConversationID)

        const newAllChatItems = getFormattedChatList((res as any).data)

        const tree = buildChatItemTree(newAllChatItems)
        setChatItemTree(tree)
        setThreadChatItems(getThreadMessages(tree, newAllChatItems.at(-1)?.id))
      }
      catch (e) {
      }
      finally {
        setFetched(true)
      }
    }
  }, [appDetail, currentConversationID])

  useEffect(() => {
    handleFetchConversationMessages()
  }, [currentConversationID, appDetail, handleFetchConversationMessages])

  const switchSibling = useCallback((siblingMessageId: string) => {
    setThreadChatItems(getThreadMessages(chatItemTree, siblingMessageId))
  }, [chatItemTree])

  return (
    <div
      className={`
        flex flex-col w-[420px] rounded-l-2xl h-full border border-black/2 shadow-xl
      `}
      style={{
        background: 'linear-gradient(156deg, rgba(242, 244, 247, 0.80) 0%, rgba(242, 244, 247, 0.00) 99.43%), var(--white, #FFF)',
      }}
    >
      {!fetched && (
        <div className='flex items-center justify-center h-full'>
          <Loading />
        </div>
      )}
      {fetched && (
        <>
          <div className='shrink-0 flex items-center justify-between p-4 pb-1 text-base font-semibold text-gray-900'>
            {`TEST CHAT#${historyWorkflowData?.sequence_number}`}
            <div
              className='flex justify-center items-center w-6 h-6 cursor-pointer'
              onClick={() => {
                handleLoadBackupDraft()
                workflowStore.setState({ historyWorkflowData: undefined })
              }}
            >
              <RiCloseLine className='w-4 h-4 text-gray-500' />
            </div>
          </div>
          <div className='grow h-0'>
            <Chat
              config={{
                supportCitationHitInfo: true,
              } as any}
              chatList={threadChatItems}
              chatContainerClassName='px-3'
              chatContainerInnerClassName='pt-6 w-full max-w-full mx-auto'
              chatFooterClassName='px-4 rounded-b-2xl'
              chatFooterInnerClassName='pb-4 w-full max-w-full mx-auto'
              chatNode={<UserInput />}
              noChatInput
              allToolIcons={{}}
              showPromptLog
              switchSibling={switchSibling}
              noSpacing
              chatAnswerContainerInner='!pr-2'
            />
          </div>
        </>
      )}
    </div>
  )
}

export default memo(ChatRecord)
