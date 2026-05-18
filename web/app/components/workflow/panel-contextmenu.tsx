import { cn } from '@langgenius/dify-ui/cn'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@langgenius/dify-ui/context-menu'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useDSL,
  useIsChatMode,
  useNodesInteractions,
  usePanelInteractions,
  useWorkflowMoveMode,
  useWorkflowStartRun,
} from './hooks'
import { useHooksStore } from './hooks-store'
import AddBlock from './operator/add-block'
import { useOperator } from './operator/hooks'
import { ShortcutKbd } from './shortcuts/shortcut-kbd'
import { useStore } from './store'
import { WorkflowRunningStatus } from './types'

const PanelContextmenu = () => {
  const { t } = useTranslation()
  const panelMenu = useStore(s => s.panelMenu)
  const clipboardElements = useStore(s => s.clipboardElements)
  const setShowImportDSLModal = useStore(s => s.setShowImportDSLModal)
  const pendingComment = useStore(s => s.pendingComment)
  const setCommentPlacing = useStore(s => s.setCommentPlacing)
  const setCommentQuickAdd = useStore(s => s.setCommentQuickAdd)
  const workflowRunningData = useStore(s => s.workflowRunningData)
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const isRestoring = useStore(s => s.isRestoring)
  const { handleNodesPaste } = useNodesInteractions()
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const {
    handleStartWorkflowRun,
    handleWorkflowStartRunInChatflow,
  } = useWorkflowStartRun()
  const { handleAddNote } = useOperator()
  const { isCommentModeAvailable } = useWorkflowMoveMode()
  const { exportCheck } = useDSL()
  const accessControl = useHooksStore(s => s.accessControl)
  const isChatMode = useIsChatMode()
  const workflowOperationReadOnly = !!(
    workflowRunningData?.result.status === WorkflowRunningStatus.Running
    || workflowRunningData?.result.status === WorkflowRunningStatus.Paused
    || historyWorkflowData
    || isRestoring
  )
  const canEditWorkflow = accessControl.canEdit && !workflowOperationReadOnly
  const canCommentWorkflow = accessControl.canComment && !workflowOperationReadOnly
  const panelMenuClientX = panelMenu?.clientX
  const panelMenuClientY = panelMenu?.clientY

  const anchor = useMemo(() => {
    if (panelMenuClientX === undefined || panelMenuClientY === undefined)
      return null

    return {
      getBoundingClientRect: () => DOMRect.fromRect({
        width: 0,
        height: 0,
        x: panelMenuClientX,
        y: panelMenuClientY,
      }),
    }
  }, [panelMenuClientX, panelMenuClientY])

  const renderAddBlockTrigger = useCallback(() => {
    return (
      <button
        type="button"
        className={cn(
          'mx-1 flex h-8 w-[calc(100%-8px)] items-center rounded-lg outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover',
          'justify-between gap-4 px-3 text-text-secondary',
        )}
      >
        {t('common.addBlock', { ns: 'workflow' })}
      </button>
    )
  }, [t])

  const handleRunAction = useCallback(() => {
    if (isChatMode)
      handleWorkflowStartRunInChatflow()
    else
      handleStartWorkflowRun()

    handlePaneContextmenuCancel()
  }, [isChatMode, handleWorkflowStartRunInChatflow, handleStartWorkflowRun, handlePaneContextmenuCancel])

  if (!panelMenu || !anchor)
    return null

  return (
    <ContextMenu
      open
      onOpenChange={open => !open && handlePaneContextmenuCancel()}
    >
      <ContextMenuContent
        positionerProps={{ anchor }}
        popupClassName="w-[200px] rounded-lg"
      >
        <ContextMenuGroup>
          {canEditWorkflow && (
            <AddBlock
              renderTrigger={renderAddBlockTrigger}
              offset={{
                mainAxis: -36,
                crossAxis: -4,
              }}
            />
          )}
          {canCommentWorkflow && (
            <ContextMenuItem
              className="justify-between gap-4 px-3 text-text-secondary"
              onClick={(e) => {
                e.stopPropagation()
                handleAddNote()
                handlePaneContextmenuCancel()
              }}
            >
              {t('nodes.note.addNote', { ns: 'workflow' })}
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
                if (pendingComment)
                  return
                setCommentQuickAdd(true)
                setCommentPlacing(true)
                handlePaneContextmenuCancel()
              }}
            >
              {t('comments.actions.addComment', { ns: 'workflow' })}
            </ContextMenuItem>
          )}
          {accessControl.canRun && (
            <ContextMenuItem
              className="justify-between gap-4 px-3 text-text-secondary"
              onClick={handleRunAction}
            >
              {isChatMode ? t('common.debugAndPreview', { ns: 'workflow' }) : t('common.run', { ns: 'workflow' })}
              {!isChatMode && <ShortcutKbd shortcut="workflow.open-test-run-menu" />}
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
                    handlePaneContextmenuCancel()
                  }
                }}
              >
                {t('common.pasteHere', { ns: 'workflow' })}
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
                {t('export', { ns: 'app' })}
              </ContextMenuItem>
              <ContextMenuItem
                className="justify-between gap-4 px-3 text-text-secondary"
                onClick={() => setShowImportDSLModal(true)}
              >
                {t('importApp', { ns: 'app' })}
              </ContextMenuItem>
            </ContextMenuGroup>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default memo(PanelContextmenu)
