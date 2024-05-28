import { useCallback, useState } from 'react'
import produce from 'immer'
import { useGetState } from 'ahooks'
import type { ConversationItem } from '@/models/share'

const storageConversationIdKey = 'conversationIdInfo'

type ConversationInfoType = Omit<ConversationItem, 'inputs' | 'id'>
function useConversation() {
  const [conversationList, setConversationList] = useState<ConversationItem[]>([])
  const [pinnedConversationList, setPinnedConversationList] = useState<ConversationItem[]>([])
  const [currConversationId, doSetCurrConversationId, getCurrConversationId] = useGetState<string>('-1')
  // when set conversation id, we do not have set appId
  const setCurrConversationId = useCallback((id: string, appId: string, isSetToLocalStroge = true, newConversationName = '') => {
    doSetCurrConversationId(id)
    if (isSetToLocalStroge && id !== '-1') {
      // conversationIdInfo: {[appId1]: conversationId1, [appId2]: conversationId2}
      const conversationIdInfo = globalThis.localStorage?.getItem(storageConversationIdKey) ? JSON.parse(globalThis.localStorage?.getItem(storageConversationIdKey) || '') : {}
      conversationIdInfo[appId] = id
      globalThis.localStorage?.setItem(storageConversationIdKey, JSON.stringify(conversationIdInfo))
    }
  }, [doSetCurrConversationId])

  const getConversationIdFromStorage = (appId: string) => {
    const conversationIdInfo = globalThis.localStorage?.getItem(storageConversationIdKey) ? JSON.parse(globalThis.localStorage?.getItem(storageConversationIdKey) || '') : {}
    const id = conversationIdInfo[appId]
    return id
  }

  const isNewConversation = currConversationId === '-1'
  // input can be updated by user
  const [newConversationInputs, setNewConversationInputs] = useState<Record<string, any> | null>(null)
  const resetNewConversationInputs = () => {
    if (!newConversationInputs)
      return
    setNewConversationInputs(produce(newConversationInputs, (draft) => {
      Object.keys(draft).forEach((key) => {
        draft[key] = ''
      })
    }))
  }
  const [existConversationInputs, setExistConversationInputs] = useState<Record<string, any> | null>(null)
  const currInputs = isNewConversation ? newConversationInputs : existConversationInputs
  const setCurrInputs = isNewConversation ? setNewConversationInputs : setExistConversationInputs

  // info is muted
  const [newConversationInfo, setNewConversationInfo] = useState<ConversationInfoType | null>(null)
  const [existConversationInfo, setExistConversationInfo] = useState<ConversationInfoType | null>(null)
  const currConversationInfo = isNewConversation ? newConversationInfo : existConversationInfo

  return {
    conversationList,
    setConversationList,
    pinnedConversationList,
    setPinnedConversationList,
    currConversationId,
    getCurrConversationId,
    setCurrConversationId,
    getConversationIdFromStorage,
    isNewConversation,
    currInputs,
    newConversationInputs,
    existConversationInputs,
    resetNewConversationInputs,
    setCurrInputs,
    currConversationInfo,
    setNewConversationInfo,
    existConversationInfo,
    setExistConversationInfo,
  }
}

export default useConversation
