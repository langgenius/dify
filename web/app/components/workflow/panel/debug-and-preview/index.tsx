import type { StartNodeType } from '../../nodes/start/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { debounce } from 'es-toolkit/compat'
import { noop } from 'es-toolkit/function'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes } from 'reactflow'
import { useStore } from '@/app/components/workflow/store'
import { useEdgesInteractionsWithoutSync } from '../../hooks/use-edges-interactions-without-sync'
import { useNodesInteractionsWithoutSync } from '../../hooks/use-nodes-interactions-without-sync'
import { useWorkflowInteractions } from '../../hooks/use-workflow-panel-interactions'
import { useResizePanel } from '../../nodes/_base/hooks/use-resize-panel'
import { useSetDebugPreviewPanelWidth } from '../../persistence/local-storage-options'
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
  const selectedNode = nodes.find((node) => node.data.selected)
  const startNode = nodes.find((node) => node.data.type === BlockEnum.Start)
  const variables = startNode?.data.variables || []
  const visibleVariables = variables
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })
  const restartLabel = t(($) => $['operation.refresh'], { ns: 'common' })
  const userInputFieldLabel = t(($) => $['panel.userInputField'], { ns: 'workflow' })

  const [showConversationVariableModal, setShowConversationVariableModal] = useState(false)

  const handleRestartChat = () => {
    handleNodeCancelRunningStatus()
    handleEdgeCancelRunningStatus()
    chatRef.current.handleRestart()
  }

  const workflowCanvasWidth = useStore((s) => s.workflowCanvasWidth)
  const nodePanelWidth = useStore((s) => s.nodePanelWidth)
  const panelWidth = useStore((s) => s.previewPanelWidth)
  const setPanelWidth = useStore((s) => s.setPreviewPanelWidth)
  const setPanelWidthStorage = useSetDebugPreviewPanelWidth()
  const handleResize = useCallback(
    (width: number, source: 'user' | 'system' = 'user') => {
      if (source === 'user') setPanelWidthStorage(width)
      setPanelWidth(width)
    },
    [setPanelWidth, setPanelWidthStorage],
  )
  const maxPanelWidth = useMemo(() => {
    if (!workflowCanvasWidth) return 720

    if (!selectedNode) return workflowCanvasWidth - 400

    return workflowCanvasWidth - 400 - 400
  }, [workflowCanvasWidth, selectedNode, nodePanelWidth])
  const { triggerRef, containerRef } = useResizePanel({
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
        className="absolute top-0 -left-1 flex h-full w-1 cursor-col-resize resize-x items-center justify-center"
      >
        <div className="h-10 w-0.5 rounded-xs bg-state-base-handle hover:h-full hover:bg-state-accent-solid active:h-full active:bg-state-accent-solid"></div>
      </div>
      <div
        ref={containerRef}
        className={cn(
          'relative flex h-full flex-col rounded-l-2xl border border-r-0 border-components-panel-border bg-chatbot-bg shadow-xl',
        )}
        style={{ width: `${panelWidth}px` }}
      >
        <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2 system-xl-semibold text-text-primary">
          <div className="h-8">
            {t(($) => $['common.debugAndPreview'], { ns: 'workflow' }).toLocaleUpperCase()}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <IconButton aria-label={restartLabel} onClick={() => handleRestartChat()}>
                    <span
                      aria-hidden="true"
                      className="i-custom-vender-line-arrows-refresh-ccw-01 size-4"
                    />
                  </IconButton>
                }
              />
              <TooltipContent>{restartLabel}</TooltipContent>
            </Tooltip>
            {visibleVariables.length > 0 && (
              <div className="relative">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <IconButton
                        aria-label={userInputFieldLabel}
                        aria-expanded={expanded}
                        className="aria-expanded:bg-state-accent-active aria-expanded:text-text-accent aria-expanded:hover:bg-state-accent-active-alt"
                        onClick={() => setExpanded(!expanded)}
                      >
                        <span aria-hidden="true" className="i-ri-equalizer-2-line size-4" />
                      </IconButton>
                    }
                  />
                  <TooltipContent>{userInputFieldLabel}</TooltipContent>
                </Tooltip>
                {expanded && (
                  <div className="absolute right-1.25 -bottom-4.25 z-10 h-3 w-3 rotate-45 border-t-[0.5px] border-l-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg" />
                )}
              </div>
            )}
            <div className="mx-3 h-3.5 w-px bg-divider-regular"></div>
            <IconButton aria-label={closeLabel} onClick={handleCancelDebugAndPreviewPanel}>
              <span aria-hidden="true" className="i-ri-close-line size-4 text-text-tertiary" />
            </IconButton>
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
