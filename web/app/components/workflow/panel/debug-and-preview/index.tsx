import {
  memo,
  useCallback,
  useEffect,
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

  const [panelWidth, setPanelWidth] = useState(420)
  const [isResizing, setIsResizing] = useState(false)

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  const stopResizing = useCallback(() => {
    setIsResizing(false)
  }, [])

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - e.clientX
      if (newWidth > 420 && newWidth < 1024)
        setPanelWidth(newWidth)
    }
  }, [isResizing])

  useEffect(() => {
    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [resize, stopResizing])

  return (
    <div
      className={cn(
        'relative flex h-full flex-col rounded-l-2xl border border-r-0 border-components-panel-border bg-chatbot-bg shadow-xl',
      )}
      style={{ width: `${panelWidth}px` }}
    >
      <div
        className="absolute bottom-0 left-[3px] top-1/2 z-50 h-6 w-[3px] cursor-col-resize rounded bg-gray-300"
        onMouseDown={startResizing}
      />
      <div className='system-xl-semibold flex shrink-0 items-center justify-between px-4 pb-2 pt-3 text-text-primary'>
        <div className='h-8'>{t('workflow.common.debugAndPreview').toLocaleUpperCase()}</div>
        <div className='flex items-center gap-1'>
          <Tooltip
            popupContent={t('common.operation.refresh')}
          >
            <ActionButton onClick={() => handleRestartChat()}>
              <RefreshCcw01 className='h-4 w-4' />
            </ActionButton>
          </Tooltip>
          {varList.length > 0 && (
            <Tooltip
              popupContent={t('workflow.chatVariable.panelTitle')}
            >
              <ActionButton onClick={() => setShowConversationVariableModal(true)}>
                <BubbleX className='h-4 w-4' />
              </ActionButton>
            </Tooltip>
          )}
          {variables.length > 0 && (
            <div className='relative'>
              <Tooltip
                popupContent={t('workflow.panel.userInputField')}
              >
                <ActionButton state={expanded ? ActionButtonState.Active : undefined} onClick={() => setExpanded(!expanded)}>
                  <RiEqualizer2Line className='h-4 w-4' />
                </ActionButton>
              </Tooltip>
              {expanded && <div className='absolute bottom-[-17px] right-[5px] z-10 h-3 w-3 rotate-45 border-l-[0.5px] border-t-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg'/>}
            </div>
          )}
          <div className='mx-3 h-3.5 w-[1px] bg-gray-200'></div>
          <div
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
            onClick={handleCancelDebugAndPreviewPanel}
          >
            <RiCloseLine className='h-4 w-4 text-gray-500' />
          </div>
        </div>
      </div>
      <div className='grow overflow-y-auto rounded-b-2xl'>
        <ChatWrapper
          ref={chatRef}
          showConversationVariableModal={showConversationVariableModal}
          onConversationModalHide={() => setShowConversationVariableModal(false)}
          showInputsFieldsPanel={expanded}
          onHide={() => setExpanded(false)}
        />
      </div>
    </div>
  )
}

export default memo(DebugAndPreview)
