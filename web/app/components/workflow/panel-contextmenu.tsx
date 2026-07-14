import { cn } from '@langgenius/dify-ui/cn'
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@langgenius/dify-ui/context-menu'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FlowType } from '@/types/common'
import { TEST_RUN_MENU_HOTKEY } from './header/shortcuts'
import {
  useDSL,
  useIsChatMode,
  useNodesInteractions,
  useWorkflowMoveMode,
  useWorkflowStartRun,
} from './hooks'
import { useHooksStore } from './hooks-store'
import { isSnippetCanvas } from './nodes/_base/hooks/snippet-input-field-vars'
import AddBlock from './operator/add-block'
import { useOperator } from './operator/hooks'
import { ShortcutKbd } from './shortcuts/shortcut-kbd'
import { useStore } from './store'
import { WorkflowRunningStatus } from './types'

export function PanelContextmenu({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const isPanelContextMenu = useStore((s) => s.contextMenuTarget?.type === 'panel')
  const clipboardElements = useStore((s) => s.clipboardElements)
  const setShowImportDSLModal = useStore((s) => s.setShowImportDSLModal)
  const pendingComment = useStore((s) => s.pendingComment)
  const setCommentPlacing = useStore((s) => s.setCommentPlacing)
  const setCommentQuickAdd = useStore((s) => s.setCommentQuickAdd)
  const workflowRunningData = useStore((s) => s.workflowRunningData)
  const historyWorkflowData = useStore((s) => s.historyWorkflowData)
  const isRestoring = useStore((s) => s.isRestoring)
  const { handleNodesPaste } = useNodesInteractions()
  const { handleStartWorkflowRun, handleWorkflowStartRunInChatflow } = useWorkflowStartRun()
  const { handleAddNote } = useOperator()
  const { isCommentModeAvailable } = useWorkflowMoveMode()
  const { exportCheck } = useDSL()
  const accessControl = useHooksStore((s) => s.accessControl)
  const flowType = useHooksStore((s) => s.configsMap?.flowType)
  const isChatMode = useIsChatMode()
  const workflowOperationReadOnly = !!(
    workflowRunningData?.result.status === WorkflowRunningStatus.Running ||
    workflowRunningData?.result.status === WorkflowRunningStatus.Paused ||
    historyWorkflowData ||
    isRestoring
  )
  const canEditWorkflow = accessControl.canEdit && !workflowOperationReadOnly
  const canCommentWorkflow = accessControl.canComment && !workflowOperationReadOnly
  const shouldHideImportApp = flowType === FlowType.snippet || isSnippetCanvas()

  const renderAddBlockTrigger = useCallback(() => {
    return (
      <ContextMenuItem
        nativeButton
        closeOnClick={false}
        render={<button type="button" />}
        className={cn(
          'w-[calc(100%-8px)]',
          'justify-between gap-4 border-0 bg-transparent px-3 text-left text-text-secondary',
        )}
      >
        {t(($) => $['common.addBlock'], { ns: 'workflow' })}
      </ContextMenuItem>
    )
  }, [t])

  const handleRunAction = useCallback(() => {
    if (isChatMode) handleWorkflowStartRunInChatflow()
    else handleStartWorkflowRun()

    onClose()
  }, [isChatMode, handleWorkflowStartRunInChatflow, handleStartWorkflowRun, onClose])

  if (!isPanelContextMenu) return null

  return (
    <ContextMenuContent popupClassName="w-[200px] rounded-lg" sideOffset={4}>
      <ContextMenuGroup>
        {canEditWorkflow && (
          <AddBlock
            renderTrigger={renderAddBlockTrigger}
            renderTriggerAsButtonRoot
            onClose={onClose}
            isolateKeyboardEvents
            offset={{
              mainAxis: -36,
              crossAxis: -4,
            }}
          />
        )}
        {canEditWorkflow && (
          <ContextMenuItem
            className="justify-between gap-4 px-3 text-text-secondary"
            onClick={(e) => {
              e.stopPropagation()
              handleAddNote()
              onClose()
            }}
          >
            {t(($) => $['nodes.note.addNote'], { ns: 'workflow' })}
          </ContextMenuItem>
        )}
        {canCommentWorkflow && isCommentModeAvailable && (
          <ContextMenuItem
            disabled={!!pendingComment}
            className={cn(
              'justify-between gap-4 px-3 text-text-secondary',
              pendingComment && 'cursor-not-allowed opacity-50',
            )}
            onClick={(e) => {
              e.stopPropagation()
              if (pendingComment) return
              setCommentQuickAdd(true)
              setCommentPlacing(true)
              onClose()
            }}
          >
            {t(($) => $['comments.actions.addComment'], { ns: 'workflow' })}
          </ContextMenuItem>
        )}
        {accessControl.canRun && (
          <ContextMenuItem
            className="justify-between gap-4 px-3 text-text-secondary"
            onClick={handleRunAction}
          >
            {isChatMode
              ? t(($) => $['common.debugAndPreview'], { ns: 'workflow' })
              : t(($) => $['common.run'], { ns: 'workflow' })}
            {!isChatMode && <ShortcutKbd hotkey={TEST_RUN_MENU_HOTKEY} />}
          </ContextMenuItem>
        )}
      </ContextMenuGroup>
      {canEditWorkflow && (
        <>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem
              disabled={!clipboardElements.length}
              className={cn(
                'justify-between gap-4 px-3 text-text-secondary',
                !clipboardElements.length && 'cursor-not-allowed opacity-50',
              )}
              onClick={() => {
                if (clipboardElements.length) {
                  handleNodesPaste()
                  onClose()
                }
              }}
            >
              {t(($) => $['common.pasteHere'], { ns: 'workflow' })}
              <ShortcutKbd shortcut="workflow.paste" />
            </ContextMenuItem>
          </ContextMenuGroup>
        </>
      )}
      {accessControl.canImportExportDSL && (
        <>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem
              className="justify-between gap-4 px-3 text-text-secondary"
              onClick={() => exportCheck?.()}
            >
              {t(($) => $.export, { ns: 'app' })}
            </ContextMenuItem>
            {!shouldHideImportApp && (
              <ContextMenuItem
                className="justify-between gap-4 px-3 text-text-secondary"
                onClick={() => setShowImportDSLModal(true)}
              >
                {t(($) => $.importApp, { ns: 'app' })}
              </ContextMenuItem>
            )}
          </ContextMenuGroup>
        </>
      )}
    </ContextMenuContent>
  )
}
