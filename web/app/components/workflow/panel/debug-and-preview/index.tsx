import type { StartNodeType } from '../../nodes/start/types'

import { RiCloseLine, RiEqualizer2Line } from '@remixicon/react'
import { debounce } from 'es-toolkit/compat'
import { noop } from 'es-toolkit/function'
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import { RefreshCcw01 } from '@/app/components/base/icons/src/vender/line/arrows'
import Tooltip from '@/app/components/base/tooltip'
import { useEdgesInteractionsWithoutSync } from '@/app/components/workflow/hooks/use-edges-interactions-without-sync'
import { useNodesInteractionsWithoutSync } from '@/app/components/workflow/hooks/use-nodes-interactions-without-sync'
import { useStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import {
  useWorkflowInteractions,
} from '../../hooks'
import { useResizePanel } from '../../nodes/_base/hooks/use-resize-panel'
import { BlockEnum } from '../../types'
import ChatWrapper from './chat-wrapper'

export type ChatWrapperRefType = {
  handleRestart: () => void
}
const DebugAndPreview = () => {
  const { t } = useTranslation()
  const chatRef = useRef({ handleRestart: noop })
  const { handleCancelDebugAndPreviewPanel } = useWorkflowInteractions()
  const { handleNodeCancelRunningStatus } = useNodesInteractionsWithoutSync()
  const { handleEdgeCancelRunningStatus } = useEdgesInteractionsWithoutSync()
  const [expanded, setExpanded] = useState(true)
  const nodes = useNodes<StartNodeType>()
  const selectedNode = nodes.find(node => node.data.selected)
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const variables = startNode?.data.variables || []
  const visibleVariables = variables

  const [showConversationVariableModal, setShowConversationVariableModal] = useState(false)

  const handleRestartChat = () => {
    handleNodeCancelRunningStatus()
    handleEdgeCancelRunningStatus()
    chatRef.current.handleRestart()
  }

  const workflowCanvasWidth = useStore(s => s.workflowCanvasWidth)
  const nodePanelWidth = useStore(s => s.nodePanelWidth)
  const panelWidth = useStore(s => s.previewPanelWidth)
  const setPanelWidth = useStore(s => s.setPreviewPanelWidth)
  const handleResize = useCallback((width: number, source: 'user' | 'system' = 'user') => {
    if (source === 'user')
      localStorage.setItem('debug-and-preview-panel-width', `${width}`)
    setPanelWidth(width)
  }, [setPanelWidth])
  const maxPanelWidth = useMemo(() => {
    if (!workflowCanvasWidth)
      return 720

    if (!selectedNode)
      return workflowCanvasWidth - 400

    return workflowCanvasWidth - 400 - 400
  }, [workflowCanvasWidth, selectedNode, nodePanelWidth])
  const {
    triggerRef,
    containerRef,
  } = useResizePanel({
    direction: 'horizontal',
    triggerDirection: 'left',
    minWidth: 400,
    maxWidth: maxPanelWidth,
    onResize: debounce((width: number) => {
      handleResize(width, 'user')
    }),
  })

  return (
    <div className="relative h-full">
      <div
        ref={triggerRef}
        className="absolute -left-1 top-0 flex h-full w-1 cursor-col-resize resize-x items-center justify-center"
      >
        <div className="h-10 w-0.5 rounded-sm bg-state-base-handle hover:h-full hover:bg-state-accent-solid active:h-full active:bg-state-accent-solid"></div>
      </div>
      <div
        ref={containerRef}
        className={cn(
          'relative flex h-full flex-col rounded-l-2xl border border-r-0 border-components-panel-border bg-chatbot-bg shadow-xl',
        )}
        style={{ width: `${panelWidth}px` }}
      >
        <div className="system-xl-semibold flex shrink-0 items-center justify-between px-4 pb-2 pt-3 text-text-primary">
          <div className="h-8">{t('common.debugAndPreview', { ns: 'workflow' }).toLocaleUpperCase()}</div>
          <div className="flex items-center gap-1">
            <Tooltip
              popupContent={t('operation.refresh', { ns: 'common' })}
            >
              <ActionButton onClick={() => handleRestartChat()}>
                <RefreshCcw01 className="h-4 w-4" />
              </ActionButton>
            </Tooltip>
            {visibleVariables.length > 0 && (
              <div className="relative">
                <Tooltip
                  popupContent={t('panel.userInputField', { ns: 'workflow' })}
                >
                  <ActionButton state={expanded ? ActionButtonState.Active : undefined} onClick={() => setExpanded(!expanded)}>
                    <RiEqualizer2Line className="h-4 w-4" />
                  </ActionButton>
                </Tooltip>
                {expanded && <div className="absolute bottom-[-17px] right-[5px] z-10 h-3 w-3 rotate-45 border-l-[0.5px] border-t-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg" />}
              </div>
            )}
            <div className="mx-3 h-3.5 w-[1px] bg-divider-regular"></div>
            <div
              className="flex h-6 w-6 cursor-pointer items-center justify-center"
              onClick={handleCancelDebugAndPreviewPanel}
            >
              <RiCloseLine className="h-4 w-4 text-text-tertiary" />
            </div>
          </div>
        </div>
        <div className="grow overflow-y-auto rounded-b-2xl">
          <ChatWrapper
            ref={chatRef}
            showConversationVariableModal={showConversationVariableModal}
            onConversationModalHide={() => setShowConversationVariableModal(false)}
            showInputsFieldsPanel={expanded}
            onHide={() => setExpanded(false)}
          />
        </div>
      </div>
    </div>
  )
}

export default memo(DebugAndPreview)
