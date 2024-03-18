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
import { fetchConvesationMessages } from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'

const ChatRecord = () => {
  const [fetched, setFetched] = useState(false)
  const [chatList, setChatList] = useState([])
  const appDetail = useAppStore(s => s.appDetail)
  const currentConversationID = useStore(s => s.currentConversationID)

  const chatMessageList = useMemo(() => {
    const res: any = []
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
          citation: item.retriever_resources,
          message_files: item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
        })
      })
    }
    return res as any
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

  if (!fetched) {
    return (
      <div className='flex items-center justify-center h-full'>
        <Loading />
      </div>
    )
  }

  return (
    <Chat
      config={{} as any}
      chatList={chatMessageList}
      chatContainerclassName='px-4'
      chatContainerInnerClassName='pt-6'
      chatFooterClassName='px-4 rounded-b-2xl'
      chatFooterInnerClassName='pb-4'
      chatNode={<UserInput />}
      noChatInput
      allToolIcons={{}}
      showPromptLog
    />
  )
}

export default memo(ChatRecord)
