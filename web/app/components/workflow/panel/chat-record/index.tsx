import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useStore } from '../../store'
import UserInput from './user-input'
import Chat from '@/app/components/base/chat/chat'
import type { ChatItem } from '@/app/components/base/chat/types'
import { fetchConvesationMessages } from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'

const ChatRecord = () => {
  const [fetched, setFetched] = useState(false)
  const [chatList, setChatList] = useState([])
  const appDetail = useAppStore(s => s.appDetail)
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const currentConversationID = historyWorkflowData?.conversation_id

  const chatMessageList = useMemo(() => {
    const res: ChatItem[] = []
    if (chatList.length) {
      chatList.forEach((item: any) => {
        res.push({
          id: `question-${item.id}`,
          content: item.query,
          isAnswer: false,
          message_files: item.message_files?.filter((file: any) => file.belongs_to === 'user') || [],
        })
        res.push({
          id: item.id,
          content: item.answer,
          feedback: item.feedback,
          isAnswer: true,
          citation: item.metadata?.retriever_resources,
          message_files: item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
          workflow_run_id: item.workflow_run_id,
        })
      })
    }
    return res
  }, [chatList])

  const handleFetchConvesationMessages = useCallback(async () => {
    if (appDetail && currentConversationID) {
      try {
        setFetched(false)
        const res = await fetchConvesationMessages(appDetail.id, currentConversationID)
        setFetched(true)
        setChatList((res as any).data)
      }
      catch (e) {

      }
    }
  }, [appDetail, currentConversationID])
  useEffect(() => {
    handleFetchConvesationMessages()
  }, [currentConversationID, appDetail, handleFetchConvesationMessages])

  return (
    <div
      className={`
        flex flex-col w-[400px] rounded-l-2xl h-full border border-black/[0.02] shadow-xl
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
          </div>
          <div className='grow h-0'>
            <Chat
              config={{
                supportCitationHitInfo: true,
              } as any}
              chatList={chatMessageList}
              chatContainerClassName='px-4'
              chatContainerInnerClassName='pt-6'
              chatFooterClassName='px-4 rounded-b-2xl'
              chatFooterInnerClassName='pb-4'
              chatNode={<UserInput />}
              noChatInput
              allToolIcons={{}}
              showPromptLog
            />
          </div>
        </>
      )}
    </div>
  )
}

export default memo(ChatRecord)
