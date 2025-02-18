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

export interface Props {
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
      className={cn('h-[640px] w-[920px] max-w-[920px] p-0')}
    >
      <div className='absolute right-4 top-4 cursor-pointer p-2' onClick={onHide}>
        <RiCloseLine className='text-text-tertiary h-4 w-4' />
      </div>
      <div className='flex h-full w-full'>
        {/* LEFT */}
        <div className='bg-background-sidenav-bg border-divider-burn flex h-full w-[224px] shrink-0 flex-col border-r'>
          <div className='text-text-primary system-xl-semibold shrink-0 pb-3 pl-5 pr-4 pt-5'>{t('workflow.chatVariable.panelTitle')}</div>
          <div className='grow overflow-y-auto px-3 py-2'>
            {varList.map(chatVar => (
              <div key={chatVar.id} className={cn('radius-md hover:bg-state-base-hover group mb-0.5 flex cursor-pointer items-center p-2', currentVar.id === chatVar.id && 'bg-state-base-hover')} onClick={() => setCurrentVar(chatVar)}>
                <BubbleX className={cn('text-text-tertiary group-hover:text-util-colors-teal-teal-700 mr-1 h-4 w-4 shrink-0', currentVar.id === chatVar.id && 'text-util-colors-teal-teal-700')} />
                <div title={chatVar.name} className={cn('text-text-tertiary system-sm-medium group-hover:text-util-colors-teal-teal-700 truncate', currentVar.id === chatVar.id && 'text-util-colors-teal-teal-700')}>{chatVar.name}</div>
              </div>
            ))}
          </div>
        </div>
        {/* RIGHT */}
        <div className='bg-components-panel-bg flex h-full w-0 grow flex-col'>
          <div className='shrink-0 p-4 pb-2'>
            <div className='flex items-center gap-1 py-1'>
              <div className='text-text-primary system-xl-semibold'>{currentVar.name}</div>
              <div className='text-text-tertiary system-xs-medium'>{capitalize(currentVar.value_type)}</div>
            </div>
          </div>
          <div className='flex h-0 grow flex-col p-4 pt-2'>
            <div className='mb-2 flex shrink-0 items-center gap-2'>
              <div className='text-text-tertiary system-xs-medium-uppercase shrink-0'>{t('workflow.chatVariable.storedContent').toLocaleUpperCase()}</div>
              <div className='h-[1px] grow' style={{
                background: 'linear-gradient(to right, rgba(16, 24, 40, 0.08) 0%, rgba(255, 255, 255) 100%)',
              }}></div>
              {latestValueTimestampMap[currentVar.id] && (
                <div className='text-text-tertiary system-xs-regular shrink-0'>{t('workflow.chatVariable.updatedAt')}{formatTime(latestValueTimestampMap[currentVar.id], t('appLog.dateTimeFormat') as string)}</div>
              )}
            </div>
            <div className='grow overflow-y-auto'>
              {currentVar.value_type !== ChatVarType.Number && currentVar.value_type !== ChatVarType.String && (
                <div className='bg-components-input-bg-normal flex h-full flex-col rounded-lg px-2 pb-2'>
                  <div className='flex h-7 shrink-0 items-center justify-between pl-3 pr-2 pt-1'>
                    <div className='text-text-secondary system-xs-semibold'>JSON</div>
                    <div className='flex items-center p-1'>
                      {!isCopied
                        ? (
                          <Clipboard className='text-text-tertiary h-4 w-4 cursor-pointer' onClick={handleCopy} />
                        )
                        : (
                          <ClipboardCheck className='text-text-tertiary h-4 w-4' />
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
                <div className='bg-components-input-bg-normal text-components-input-text-filled system-md-regular h-full overflow-y-auto overflow-x-hidden rounded-lg px-4 py-3'>{latestValueMap[currentVar.id] || ''}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default ConversationVariableModal
