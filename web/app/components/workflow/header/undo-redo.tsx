import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ViewWorkflowHistory from '@/app/components/workflow/header/view-workflow-history'
import { useWorkflowHistoryStore } from '@/app/components/workflow/workflow-history-store'
import Divider from '../../base/divider'
import { useNodesReadOnly } from '../hooks/use-workflow'
import TipPopup from '../operator/tip-popup'

type UndoRedoProps = { handleUndo: () => void; handleRedo: () => void }
function UndoRedo({ handleUndo, handleRedo }: UndoRedoProps) {
  const { t } = useTranslation()
  const { store } = useWorkflowHistoryStore()
  const [buttonsDisabled, setButtonsDisabled] = useState({ undo: true, redo: true })

  useEffect(() => {
    const unsubscribe = store.temporal.subscribe((state) => {
      setButtonsDisabled({
        undo: state.pastStates.length === 0,
        redo: state.futureStates.length === 0,
      })
    })
    return () => unsubscribe()
  }, [store])

  const { nodesReadOnly } = useNodesReadOnly()

  return (
    <div className="flex items-center space-x-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-[5px]">
      <TipPopup title={t(($) => $['common.undo'], { ns: 'workflow' })!} shortcut="workflow.undo">
        <IconButton
          size="lg"
          className="rounded-md"
          aria-label={t(($) => $['common.undo'], { ns: 'workflow' })!}
          data-tooltip-id="workflow.undo"
          disabled={nodesReadOnly || buttonsDisabled.undo}
          focusableWhenDisabled
          onClick={handleUndo}
        >
          <span aria-hidden className="i-ri-arrow-go-back-line size-4" />
        </IconButton>
      </TipPopup>
      <TipPopup title={t(($) => $['common.redo'], { ns: 'workflow' })!} shortcut="workflow.redo">
        <IconButton
          size="lg"
          className="rounded-md"
          aria-label={t(($) => $['common.redo'], { ns: 'workflow' })!}
          data-tooltip-id="workflow.redo"
          disabled={nodesReadOnly || buttonsDisabled.redo}
          focusableWhenDisabled
          onClick={handleRedo}
        >
          <span aria-hidden className="i-ri-arrow-go-forward-fill size-4" />
        </IconButton>
      </TipPopup>
      <Divider type="vertical" className="mx-0.5 h-3.5" />
      <ViewWorkflowHistory />
    </div>
  )
}

export default memo(UndoRedo)
