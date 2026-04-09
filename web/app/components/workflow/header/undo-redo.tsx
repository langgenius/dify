import type { FC } from 'react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import ViewWorkflowHistory from '@/app/components/workflow/header/view-workflow-history'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { cn } from '@/utils/classnames'
import Divider from '../../base/divider'
import TipPopup from '../operator/tip-popup'

type UndoRedoProps = { handleUndo: () => void, handleRedo: () => void }
const UndoRedo: FC<UndoRedoProps> = ({ handleUndo, handleRedo }) => {
  const { t } = useTranslation()
  const [buttonsDisabled, setButtonsDisabled] = useState({ undo: true, redo: true })

  useEffect(() => {
    // Update button states based on Loro's UndoManager
    const updateButtonStates = () => {
      setButtonsDisabled({
        undo: !collaborationManager.canUndo(),
        redo: !collaborationManager.canRedo(),
      })
    }

    // Initial state
    Promise.resolve().then(() => {
      updateButtonStates()
    })

    // Listen for undo/redo state changes
    const unsubscribe = collaborationManager.onUndoRedoStateChange((state) => {
      setButtonsDisabled({
        undo: !state.canUndo,
        redo: !state.canRedo,
      })
    })

    return () => unsubscribe()
  }, [])

  const { nodesReadOnly } = useNodesReadOnly()

  return (
    <div className="flex items-center space-x-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-[5px]">
      <TipPopup title={t('common.undo', { ns: 'workflow' })!} shortcuts={['ctrl', 'z']}>
        <button
          type="button"
          aria-label={t('common.undo', { ns: 'workflow' })!}
          data-tooltip-id="workflow.undo"
          disabled={nodesReadOnly || buttonsDisabled.undo}
          className={
            cn('system-sm-medium flex h-8 w-8 cursor-pointer select-none items-center rounded-md px-1.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary', (nodesReadOnly || buttonsDisabled.undo)
            && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled')
          }
          onClick={handleUndo}
        >
          <span className="i-ri-arrow-go-back-line h-4 w-4" />
        </button>
      </TipPopup>
      <TipPopup title={t('common.redo', { ns: 'workflow' })!} shortcuts={['ctrl', 'y']}>
        <button
          type="button"
          aria-label={t('common.redo', { ns: 'workflow' })!}
          data-tooltip-id="workflow.redo"
          disabled={nodesReadOnly || buttonsDisabled.redo}
          className={
            cn('system-sm-medium flex h-8 w-8 cursor-pointer select-none items-center rounded-md px-1.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary', (nodesReadOnly || buttonsDisabled.redo)
            && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled')
          }
          onClick={handleRedo}
        >
          <span className="i-ri-arrow-go-forward-fill h-4 w-4" />
        </button>
      </TipPopup>
      <Divider type="vertical" className="mx-0.5 h-3.5" />
      <ViewWorkflowHistory />
    </div>
  )
}

export default memo(UndoRedo)
