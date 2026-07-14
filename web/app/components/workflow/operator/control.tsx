import type { MouseEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '../../base/divider'
import { useNodesReadOnly, useWorkflowMoveMode, useWorkflowOrganize } from '../hooks'
import { useStore } from '../store'
import { ControlMode } from '../types'
import AddBlock from './add-block'
import { useOperator } from './hooks'
import MoreActions from './more-actions'
import TipPopup from './tip-popup'

const Control = () => {
  const { t } = useTranslation()
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

  const addNote = (e: MouseEvent<HTMLButtonElement>) => {
    if (getNodesReadOnly()) return

    e.stopPropagation()
    handleAddNote()
  }

  return (
    <div className="pointer-events-auto flex flex-col items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary shadow-lg">
      <AddBlock />
      <TipPopup title={t(($) => $['nodes.note.addNote'], { ns: 'workflow' })}>
        <Button
          variant="ghost"
          size="small"
          aria-label={t(($) => $['nodes.note.addNote'], { ns: 'workflow' })}
          disabled={nodesReadOnly}
          focusableWhenDisabled
          className={cn(
            'ml-px size-8 p-0 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            nodesReadOnly &&
              'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
          )}
          onClick={addNote}
        >
          <span aria-hidden className="i-ri-sticky-note-add-line size-4" />
        </Button>
      </TipPopup>
      <Divider className="my-1 w-3.5" />
      <TipPopup
        title={t(($) => $['common.pointerMode'], { ns: 'workflow' })}
        shortcut="workflow.pointer-mode"
      >
        <Button
          variant="ghost"
          size="small"
          aria-label={t(($) => $['common.pointerMode'], { ns: 'workflow' })}
          disabled={nodesReadOnly}
          focusableWhenDisabled
          className={cn(
            'mr-px size-8 p-0 text-text-tertiary',
            controlMode === ControlMode.Pointer
              ? 'bg-state-accent-active text-text-accent'
              : 'hover:bg-state-base-hover hover:text-text-secondary',
            nodesReadOnly &&
              'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
          )}
          onClick={handleModePointer}
        >
          <span aria-hidden className="i-ri-cursor-line size-4" />
        </Button>
      </TipPopup>
      <TipPopup
        title={t(($) => $['common.handMode'], { ns: 'workflow' })}
        shortcut="workflow.hand-mode"
      >
        <Button
          variant="ghost"
          size="small"
          aria-label={t(($) => $['common.handMode'], { ns: 'workflow' })}
          disabled={nodesReadOnly}
          focusableWhenDisabled
          className={cn(
            'size-8 p-0 text-text-tertiary',
            controlMode === ControlMode.Hand
              ? 'bg-state-accent-active text-text-accent'
              : 'hover:bg-state-base-hover hover:text-text-secondary',
            nodesReadOnly &&
              'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
          )}
          onClick={handleModeHand}
        >
          <span aria-hidden className="i-ri-hand size-4" />
        </Button>
      </TipPopup>
      {isCommentModeAvailable && (
        <TipPopup
          title={t(($) => $['common.commentMode'], { ns: 'workflow' })}
          shortcut="workflow.comment-mode"
        >
          <Button
            variant="ghost"
            size="small"
            aria-label={t(($) => $['common.commentMode'], { ns: 'workflow' })}
            disabled={!canUseCommentMode}
            focusableWhenDisabled
            className={cn(
              'ml-px size-8 p-0 text-text-tertiary',
              controlMode === ControlMode.Comment
                ? 'bg-state-accent-active text-text-accent'
                : 'hover:bg-state-base-hover hover:text-text-secondary',
              !canUseCommentMode &&
                'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
            )}
            onClick={handleModeComment}
          >
            <span aria-hidden className="i-custom-public-other-comment size-4" />
          </Button>
        </TipPopup>
      )}
      <Divider className="my-1 w-3.5" />
      <TipPopup
        title={t(($) => $['panel.organizeBlocks'], { ns: 'workflow' })}
        shortcut="workflow.organize"
      >
        <Button
          variant="ghost"
          size="small"
          aria-label={t(($) => $['panel.organizeBlocks'], { ns: 'workflow' })}
          disabled={nodesReadOnly}
          focusableWhenDisabled
          className={cn(
            'size-8 p-0 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            nodesReadOnly &&
              'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
          )}
          onClick={handleLayout}
        >
          <span aria-hidden className="i-ri-function-add-line size-4" />
        </Button>
      </TipPopup>
      <MoreActions />
    </div>
  )
}

export default memo(Control)
