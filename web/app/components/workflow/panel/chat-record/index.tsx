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
import type { ChatItem } from '@/app/components/base/chat/types'
import { fetchConversationMessages } from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { UUID_NIL } from '@/app/components/base/chat/constants'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'

function appendQAToChatList(newChatList: ChatItem[], item: any) {
  const answerFiles = item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || []
  newChatList.push({
    id: item.id,
    content: item.answer,
    feedback: item.feedback,
    isAnswer: true,
    citation: item.metadata?.retriever_resources,
    message_files: getProcessedFilesFromResponse(answerFiles.map((item: any) => ({ ...item, related_id: item.id }))),
    workflow_run_id: item.workflow_run_id,
  })
  const questionFiles = item.message_files?.filter((file: any) => file.belongs_to === 'user') || []
  newChatList.push({
    id: `question-${item.id}`,
    content: item.query,
    isAnswer: false,
    message_files: getProcessedFilesFromResponse(questionFiles.map((item: any) => ({ ...item, related_id: item.id }))),
  })
}

function getFormattedChatList(messages: any[]) {
  const newChatList: ChatItem[] = []
  let nextMessageId = null
  for (const item of messages) {
    if (!item.parent_message_id) {
      appendQAToChatList(newChatList, item)
      break
    }

    if (!nextMessageId) {
      appendQAToChatList(newChatList, item)
      nextMessageId = item.parent_message_id
    }
    else {
      if (item.id === nextMessageId || nextMessageId === UUID_NIL) {
        appendQAToChatList(newChatList, item)
        nextMessageId = item.parent_message_id
      }
    }
  }
  return newChatList.reverse()
}

const ChatRecord = () => {
  const [fetched, setFetched] = useState(false)
  const [chatList, setChatList] = useState<ChatItem[]>([])
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
        setChatList(getFormattedChatList((res as any).data))
      }
      catch (e) {
        console.error(e)
      }
      finally {
        setFetched(true)
      }
    }
  }, [appDetail, currentConversationID])
  useEffect(() => {
    handleFetchConversationMessages()
  }, [currentConversationID, appDetail, handleFetchConversationMessages])

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
              chatList={chatList}
              chatContainerClassName='px-3'
              chatContainerInnerClassName='pt-6 w-full max-w-full mx-auto'
              chatFooterClassName='px-4 rounded-b-2xl'
              chatFooterInnerClassName='pb-4 w-full max-w-full mx-auto'
              chatNode={<UserInput />}
              noChatInput
              allToolIcons={{}}
              showPromptLog
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
