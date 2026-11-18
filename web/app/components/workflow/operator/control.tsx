import type { MouseEvent } from 'react'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Separator } from '@langgenius/dify-ui/separator'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { useAtomValue } from 'jotai'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { collaborationUpgradeDialogAtom } from '../collaboration/upgrade-state'
import { useNodesReadOnly } from '../hooks/use-workflow'
import { useWorkflowOrganize } from '../hooks/use-workflow-organize'
import { useWorkflowMoveMode } from '../hooks/use-workflow-panel-interactions'
import { useStore } from '../store'
import { ControlMode } from '../types'
import AddBlock from './add-block'
import { ExportImage } from './export-image'
import { useOperator } from './hooks'
import TipPopup from './tip-popup'

const pressedModeClassName =
  'data-pressed:bg-state-accent-active data-pressed:text-text-accent data-pressed:hover:bg-state-base-hover data-pressed:hover:text-text-secondary data-disabled:data-pressed:text-text-disabled data-disabled:data-pressed:hover:bg-transparent data-disabled:data-pressed:hover:text-text-disabled'

const Control = () => {
  const { t } = useTranslation(['workflow', 'billing'])
  const upgradeDialog = useAtomValue(collaborationUpgradeDialogAtom)
  const controlMode = useStore((s) => s.controlMode)
  const {
    handleModePointer,
    handleModeHand,
    handleModeComment,
    isCommentModeAvailable,
    canUseCommentMode,
  } = useWorkflowMoveMode()
  const { handleLayout } = useWorkflowOrganize()
  const { handleAddNote } = useOperator()
  const { nodesReadOnly, getNodesReadOnly } = useNodesReadOnly()
  const commentModeLabel = t(($) => $['common.commentMode'], { ns: 'workflow' })
  const upgradeLabel = t(($) => $['upgrade.workflowCollaboration.title'], { ns: 'billing' })

  const addNote = (e: MouseEvent<HTMLButtonElement>) => {
    if (getNodesReadOnly()) return

    e.stopPropagation()
    handleAddNote()
  }

  return (
    <div className="pointer-events-auto flex flex-col items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary shadow-lg">
      <AddBlock />
      <TipPopup title={t(($) => $['nodes.note.addNote'], { ns: 'workflow' })}>
        <IconButton
          size="lg"
          aria-label={t(($) => $['nodes.note.addNote'], { ns: 'workflow' })}
          disabled={nodesReadOnly}
          focusableWhenDisabled
          className="ms-px rounded-md"
          onClick={addNote}
        >
          <span aria-hidden className="i-ri-sticky-note-add-line size-4" />
        </IconButton>
      </TipPopup>
      <Separator className="my-1 h-[0.5px] w-3.5" />
      <TipPopup
        title={t(($) => $['common.pointerMode'], { ns: 'workflow' })}
        shortcut="workflow.pointer-mode"
      >
        <Toggle
          pressed={controlMode === ControlMode.Pointer}
          onPressedChange={handleModePointer}
          disabled={nodesReadOnly}
          className={pressedModeClassName}
          render={
            <IconButton
              size="lg"
              aria-label={t(($) => $['common.pointerMode'], { ns: 'workflow' })}
              disabled={nodesReadOnly}
              focusableWhenDisabled
              className="me-px rounded-md"
            >
              <span aria-hidden className="i-ri-cursor-line size-4" />
            </IconButton>
          }
        />
      </TipPopup>
      <TipPopup
        title={t(($) => $['common.handMode'], { ns: 'workflow' })}
        shortcut="workflow.hand-mode"
      >
        <Toggle
          pressed={controlMode === ControlMode.Hand}
          onPressedChange={handleModeHand}
          disabled={nodesReadOnly}
          className={pressedModeClassName}
          render={
            <IconButton
              size="lg"
              aria-label={t(($) => $['common.handMode'], { ns: 'workflow' })}
              disabled={nodesReadOnly}
              focusableWhenDisabled
              className="rounded-md"
            >
              <span aria-hidden className="i-ri-hand size-4" />
            </IconButton>
          }
        />
      </TipPopup>
      {isCommentModeAvailable ? (
        <TipPopup title={commentModeLabel} shortcut="workflow.comment-mode">
          <Toggle
            pressed={controlMode === ControlMode.Comment}
            onPressedChange={handleModeComment}
            disabled={!canUseCommentMode}
            className={pressedModeClassName}
            render={
              <IconButton
                size="lg"
                aria-label={commentModeLabel}
                disabled={!canUseCommentMode}
                focusableWhenDisabled
                className="ms-px rounded-md"
              >
                <span aria-hidden className="i-custom-public-other-comment size-4" />
              </IconButton>
            }
          />
        </TipPopup>
      ) : upgradeDialog ? (
        <TipPopup title={upgradeLabel}>
          <DialogTrigger
            handle={upgradeDialog}
            render={
              <IconButton size="lg" aria-label={upgradeLabel} className="ms-px rounded-md">
                <span aria-hidden className="i-custom-public-other-comment size-4" />
              </IconButton>
            }
          />
        </TipPopup>
      ) : null}
      <Separator className="my-1 h-[0.5px] w-3.5" />
      <TipPopup
        title={t(($) => $['panel.organizeBlocks'], { ns: 'workflow' })}
        shortcut="workflow.organize"
      >
        <IconButton
          size="lg"
          aria-label={t(($) => $['panel.organizeBlocks'], { ns: 'workflow' })}
          disabled={nodesReadOnly}
          focusableWhenDisabled
          className="rounded-md"
          onClick={handleLayout}
        >
          <span aria-hidden className="i-ri-function-add-line size-4" />
        </IconButton>
      </TipPopup>
      <ExportImage />
    </div>
  )
}

export default memo(Control)
