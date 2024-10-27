'use client'
import React, { useCallback } from 'react'
import { useMount } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { capitalize } from 'lodash-es'
import copy from 'copy-to-clipboard'
import { RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import { BubbleX } from '@/app/components/base/icons/src/vender/line/others'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import {
  Clipboard,
  ClipboardCheck,
} from '@/app/components/base/icons/src/vender/line/files'
import { useStore } from '@/app/components/workflow/store'
import type {
  ConversationVariable,
} from '@/app/components/workflow/types'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import useTimestamp from '@/hooks/use-timestamp'
import { fetchCurrentValueOfConversationVariable } from '@/service/workflow'
import cn from '@/utils/classnames'

export type Props = {
  conversationID: string
  onHide: () => void
}

const ConversationVariableModal = ({
  conversationID,
  onHide,
}: Props) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const varList = useStore(s => s.conversationVariables) as ConversationVariable[]
  const appID = useStore(s => s.appId)
  const [currentVar, setCurrentVar] = React.useState<ConversationVariable>(varList[0])
  const [latestValueMap, setLatestValueMap] = React.useState<Record<string, string>>({})
  const [latestValueTimestampMap, setLatestValueTimestampMap] = React.useState<Record<string, number>>({})

  const getChatVarLatestValues = useCallback(async () => {
    if (conversationID && varList.length > 0) {
      const res = await fetchCurrentValueOfConversationVariable({
        url: `/apps/${appID}/conversation-variables`,
        params: { conversation_id: conversationID },
      })
      if (res.data.length > 0) {
        const valueMap = res.data.reduce((acc: any, cur) => {
          acc[cur.id] = cur.value
          return acc
        }, {})
        setLatestValueMap(valueMap)
        const timestampMap = res.data.reduce((acc: any, cur) => {
          acc[cur.id] = cur.updated_at
          return acc
        }, {})
        setLatestValueTimestampMap(timestampMap)
      }
    }
  }, [appID, conversationID, varList.length])

  const [isCopied, setIsCopied] = React.useState(false)
  const handleCopy = useCallback(() => {
    copy(currentVar.value)
    setIsCopied(true)
    setTimeout(() => {
      setIsCopied(false)
    }, 2000)
  }, [currentVar.value])

  useMount(() => {
    getChatVarLatestValues()
  })

  return (
    <Modal
      isShow
      onClose={() => { }}
      className={cn('w-[920px] max-w-[920px] h-[640px] p-0')}
    >
      <div className='absolute right-4 top-4 p-2 cursor-pointer' onClick={onHide}>
        <RiCloseLine className='w-4 h-4 text-text-tertiary' />
      </div>
      <div className='w-full h-full flex'>
        {/* LEFT */}
        <div className='shrink-0 flex flex-col w-[224px] h-full bg-background-sidenav-bg border-r border-divider-burn'>
          <div className='shrink-0 pt-5 pl-5 pr-4 pb-3 text-text-primary system-xl-semibold'>{t('workflow.chatVariable.panelTitle')}</div>
          <div className='grow overflow-y-auto px-3 py-2'>
            {varList.map(chatVar => (
              <div key={chatVar.id} className={cn('group mb-0.5 p-2 flex items-center radius-md hover:bg-state-base-hover cursor-pointer', currentVar.id === chatVar.id && 'bg-state-base-hover')} onClick={() => setCurrentVar(chatVar)}>
                <BubbleX className={cn('shrink-0 mr-1 w-4 h-4 text-text-tertiary group-hover:text-util-colors-teal-teal-700', currentVar.id === chatVar.id && 'text-util-colors-teal-teal-700')} />
                <div title={chatVar.name} className={cn('text-text-tertiary system-sm-medium truncate group-hover:text-util-colors-teal-teal-700', currentVar.id === chatVar.id && 'text-util-colors-teal-teal-700')}>{chatVar.name}</div>
              </div>
            ))}
          </div>
        </div>
        {/* RIGHT */}
        <div className='grow flex flex-col h-full bg-components-panel-bg'>
          <div className='shrink-0 p-4 pb-2'>
            <div className='flex items-center gap-1 py-1'>
              <div className='text-text-primary system-xl-semibold'>{currentVar.name}</div>
              <div className='text-text-tertiary system-xs-medium'>{capitalize(currentVar.value_type)}</div>
            </div>
          </div>
          <div className='grow p-4 pt-2 flex flex-col'>
            <div className='shrink-0 mb-2 flex items-center gap-2'>
              <div className='shrink-0 text-text-tertiary system-xs-medium-uppercase'>{t('workflow.chatVariable.storedContent').toLocaleUpperCase()}</div>
              <div className='grow h-[1px]' style={{
                background: 'linear-gradient(to right, rgba(16, 24, 40, 0.08) 0%, rgba(255, 255, 255) 100%)',
              }}></div>
              {latestValueTimestampMap[currentVar.id] && (
                <div className='shrink-0 text-text-tertiary system-xs-regular'>{t('workflow.chatVariable.updatedAt')}{formatTime(latestValueTimestampMap[currentVar.id], t('appLog.dateTimeFormat') as string)}</div>
              )}
            </div>
            <div className='grow'>
              {currentVar.value_type !== ChatVarType.Number && currentVar.value_type !== ChatVarType.String && (
                <div className='h-full flex flex-col bg-components-input-bg-normal rounded-lg px-2 pb-2'>
                  <div className='shrink-0 flex justify-between items-center h-7 pt-1 pl-3 pr-2'>
                    <div className='text-text-secondary system-xs-semibold'>JSON</div>
                    <div className='flex items-center p-1'>
                      {!isCopied
                        ? (
                          <Clipboard className='w-4 h-4 text-text-tertiary cursor-pointer' onClick={handleCopy} />
                        )
                        : (
                          <ClipboardCheck className='w-4 h-4 text-text-tertiary' />
                        )
                      }
                    </div>
                  </div>
                  <div className='grow pl-4'>
                    <CodeEditor
                      readOnly
                      noWrapper
                      isExpand
                      language={CodeLanguage.json}
                      value={latestValueMap[currentVar.id] || ''}
                      isJSONStringifyBeauty
                    />
                  </div>
                </div>
              )}
              {(currentVar.value_type === ChatVarType.Number || currentVar.value_type === ChatVarType.String) && (
                <div className='h-full px-4 py-3 rounded-lg bg-components-input-bg-normal text-components-input-text-filled system-md-regular overflow-y-auto'>{latestValueMap[currentVar.id] || ''}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default ConversationVariableModal
