import {
  memo,
  useRef,
  useState,
} from 'react'
import { useKeyPress } from 'ahooks'
import { RiCloseLine, RiEqualizer2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import {
  useEdgesInteractions,
  useNodesInteractions,
  useWorkflowInteractions,
} from '../../hooks'
import { BlockEnum } from '../../types'
import type { StartNodeType } from '../../nodes/start/types'
import ChatWrapper from './chat-wrapper'
import cn from '@/utils/classnames'
import { RefreshCcw01 } from '@/app/components/base/icons/src/vender/line/arrows'
import { BubbleX } from '@/app/components/base/icons/src/vender/line/others'
import Tooltip from '@/app/components/base/tooltip'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import { useStore } from '@/app/components/workflow/store'

export type ChatWrapperRefType = {
  handleRestart: () => void
}
const DebugAndPreview = () => {
  const { t } = useTranslation()
  const chatRef = useRef({ handleRestart: () => { } })
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { handleNodeCancelRunningStatus } = useNodesInteractions()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractions()
  const varList = useStore(s => s.conversationVariables)
  const [expanded, setExpanded] = useState(true)
  const nodes = useNodes<StartNodeType>()
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const variables = startNode?.data.variables || []

  const [showConversationVariableModal, setShowConversationVariableModal] = useState(false)

  const handleRestartChat = () => {
    handleNodeCancelRunningStatus()
    handleEdgeCancelRunningStatus()
    chatRef.current.handleRestart()
  }

  useKeyPress('shift.r', () => {
    handleRestartChat()
  }, {
    exactMatch: true,
  })

  return (
    <div
      className={cn(
        'flex flex-col w-[420px] rounded-l-2xl h-full border border-black/2',
      )}
      style={{
        background: 'linear-gradient(156deg, rgba(242, 244, 247, 0.80) 0%, rgba(242, 244, 247, 0.00) 99.43%), var(--white, #FFF)',
      }}
    >
      <div className='shrink-0 flex items-center justify-between px-4 pt-3 pb-2 text-text-primary system-xl-semibold'>
        <div className='h-8'>{t('workflow.common.debugAndPreview').toLocaleUpperCase()}</div>
        <div className='flex items-center gap-1'>
          <Tooltip
            popupContent={t('common.operation.refresh')}
          >
            <ActionButton onClick={() => handleRestartChat()}>
              <RefreshCcw01 className='w-4 h-4' />
            </ActionButton>
          </Tooltip>
          {varList.length > 0 && (
            <Tooltip
              popupContent={t('workflow.chatVariable.panelTitle')}
            >
              <ActionButton onClick={() => setShowConversationVariableModal(true)}>
                <BubbleX className='w-4 h-4' />
              </ActionButton>
            </Tooltip>
          )}
          {variables.length > 0 && (
            <div className='relative'>
              <Tooltip
                popupContent={t('workflow.panel.userInputField')}
              >
                <ActionButton state={expanded ? ActionButtonState.Active : undefined} onClick={() => setExpanded(!expanded)}>
                  <RiEqualizer2Line className='w-4 h-4' />
                </ActionButton>
              </Tooltip>
            </div>
          )}
          <div className='mx-3 w-[1px] h-3.5 bg-gray-200'></div>
          <div
            className='flex items-center justify-center w-6 h-6 cursor-pointer'
            onClick={handleCancelDebugAndPreviewPanel}
          >
            <RiCloseLine className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      </div>
      <div className='grow rounded-b-2xl overflow-y-auto'>
        <ChatWrapper
          ref={chatRef}
          showConversationVariableModal={showConversationVariableModal}
          onConversationModalHide={() => setShowConversationVariableModal(false)}
          showInputsFieldsPanel={expanded}
        />
      </div>
    </div>
  )
}

export default memo(DebugAndPreview)
