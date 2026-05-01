import { cn } from '@langgenius/dify-ui/cn'
import { useClickAway } from 'ahooks'
import {
  memo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '../base/divider'
import {
  useDSL,
  useNodesInteractions,
  usePanelInteractions,
  useWorkflowMoveMode,
  useWorkflowStartRun,
} from './hooks'
import AddBlock from './operator/add-block'
import { useOperator } from './operator/hooks'
import { ShortcutKbd } from './shortcuts/shortcut-kbd'
import { useStore } from './store'

const PanelContextmenu = () => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const panelMenu = useStore(s => s.panelMenu)
  const clipboardElements = useStore(s => s.clipboardElements)
  const setShowImportDSLModal = useStore(s => s.setShowImportDSLModal)
  const pendingComment = useStore(s => s.pendingComment)
  const setCommentPlacing = useStore(s => s.setCommentPlacing)
  const setCommentQuickAdd = useStore(s => s.setCommentQuickAdd)
  const { handleNodesPaste } = useNodesInteractions()
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const { handleStartWorkflowRun } = useWorkflowStartRun()
  const { handleAddNote } = useOperator()
  const { isCommentModeAvailable } = useWorkflowMoveMode()
  const { exportCheck } = useDSL()

  useClickAway(() => {
    handlePaneContextmenuCancel()
  }, ref)

  const renderTrigger = () => {
    return (
      <button
        type="button"
        className="flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
      >
        {t('common.addBlock', { ns: 'workflow' })}
      </button>
    )
  }

  if (!panelMenu)
    return null

  return (
    <div
      className="absolute z-9 w-[200px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg"
      style={{
        left: panelMenu.left,
        top: panelMenu.top,
      }}
      ref={ref}
    >
      <div className="p-1">
        <AddBlock
          renderTrigger={renderTrigger}
          offset={{
            mainAxis: -36,
            crossAxis: -4,
          }}
        />
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
          onClick={(e) => {
            e.stopPropagation()
            handleAddNote()
            handlePaneContextmenuCancel()
          }}
        >
          {t('nodes.note.addNote', { ns: 'workflow' })}
        </button>
        {isCommentModeAvailable && (
          <button
            type="button"
            disabled={!!pendingComment}
            className={cn(
              'flex h-8 w-full items-center justify-between rounded-lg px-3 text-sm text-text-secondary',
              pendingComment ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-state-base-hover',
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
          </button>
        )}
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
          onClick={() => {
            handleStartWorkflowRun()
            handlePaneContextmenuCancel()
          }}
        >
          {t('common.run', { ns: 'workflow' })}
          <ShortcutKbd shortcut="workflow.open-test-run-menu" />
        </button>
      </div>
      <Divider className="m-0" />
      <div className="p-1">
        <button
          type="button"
          disabled={!clipboardElements.length}
          className={cn(
            'flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary',
            !clipboardElements.length ? 'cursor-not-allowed opacity-50' : 'hover:bg-state-base-hover',
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
        </button>
      </div>
      <Divider className="m-0" />
      <div className="p-1">
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
          onClick={() => exportCheck?.()}
        >
          {t('export', { ns: 'app' })}
        </button>
        <button
          type="button"
          className="flex h-8 w-full cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
          onClick={() => setShowImportDSLModal(true)}
        >
          {t('importApp', { ns: 'app' })}
        </button>
      </div>
    </div>
  )
}

export default memo(PanelContextmenu)
