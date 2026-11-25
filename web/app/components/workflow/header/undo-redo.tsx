import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Separator } from '@langgenius/dify-ui/separator'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import ViewWorkflowHistory from '@/app/components/workflow/header/view-workflow-history'
import { useTemporalWorkflowHistory } from '@/app/components/workflow/workflow-history-store'
import { useCanvasDraftHistory } from '../hooks/use-canvas-draft-history'
import { useNodesReadOnly } from '../hooks/use-workflow'
import TipPopup from '../operator/tip-popup'

type UndoRedoProps = { handleUndo: () => void; handleRedo: () => void }
function UndoRedo({ handleUndo, handleRedo }: UndoRedoProps) {
  const { t } = useTranslation(['workflow'])
  const draftHistory = useCanvasDraftHistory()
  const { pastStates, futureStates } = useTemporalWorkflowHistory()
  const { nodesReadOnly } = useNodesReadOnly()

  return (
    <div className="flex items-center space-x-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-[5px]">
      <TipPopup title={t(($) => $['common.undo'], { ns: 'workflow' })!} shortcut="workflow.undo">
        <IconButton
          size="lg"
          className="rounded-md"
          aria-label={t(($) => $['common.undo'], { ns: 'workflow' })!}
          data-tooltip-id="workflow.undo"
          disabled={nodesReadOnly || !(draftHistory?.undo ?? pastStates).length}
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
          disabled={nodesReadOnly || !(draftHistory?.redo ?? futureStates).length}
          focusableWhenDisabled
          onClick={handleRedo}
        >
          <span aria-hidden className="i-ri-arrow-go-forward-fill size-4" />
        </IconButton>
      </TipPopup>
      <Separator orientation="vertical" className="mx-0.5 h-3.5" />
      <ViewWorkflowHistory />
    </div>
  )
}

export default memo(UndoRedo)
