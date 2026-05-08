import type { MouseEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiAspectRatioFill,
  RiAspectRatioLine,
  RiCursorLine,
  RiFunctionAddLine,
  RiHand,
  RiStickyNoteAddLine,
} from '@remixicon/react'
import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Comment } from '@/app/components/base/icons/src/public/other'
import Divider from '../../base/divider'
import {
  useNodesReadOnly,
  useWorkflowCanvasMaximize,
  useWorkflowMoveMode,
  useWorkflowOrganize,
} from '../hooks'
import { useStore } from '../store'
import {
  ControlMode,
} from '../types'
import AddBlock from './add-block'
import { useOperator } from './hooks'
import MoreActions from './more-actions'
import TipPopup from './tip-popup'

const Control = () => {
  const { t } = useTranslation()
  const controlMode = useStore(s => s.controlMode)
  const maximizeCanvas = useStore(s => s.maximizeCanvas)
  const {
    handleModePointer,
    handleModeHand,
    handleModeComment,
    isCommentModeAvailable,
  } = useWorkflowMoveMode()
  const { handleLayout } = useWorkflowOrganize()
  const { handleAddNote } = useOperator()
  const {
    nodesReadOnly,
    getNodesReadOnly,
  } = useNodesReadOnly()
  const { handleToggleMaximizeCanvas } = useWorkflowCanvasMaximize()

  const addNote = (e: MouseEvent<HTMLButtonElement>) => {
    if (getNodesReadOnly())
      return

    e.stopPropagation()
    handleAddNote()
  }

  return (
    <div className="pointer-events-auto flex flex-col items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary shadow-lg">
      <AddBlock />
      <TipPopup title={t('nodes.note.addNote', { ns: 'workflow' })}>
        <button
          type="button"
          aria-label={t('nodes.note.addNote', { ns: 'workflow' })}
          disabled={nodesReadOnly}
          className={cn(
            'ml-px flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={addNote}
        >
          <RiStickyNoteAddLine aria-hidden className="h-4 w-4" />
        </button>
      </TipPopup>
      <Divider className="my-1 w-3.5" />
      <TipPopup title={t('common.pointerMode', { ns: 'workflow' })} shortcut="workflow.pointer-mode">
        <button
          type="button"
          aria-label={t('common.pointerMode', { ns: 'workflow' })}
          disabled={nodesReadOnly}
          className={cn(
            'mr-px flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
            controlMode === ControlMode.Pointer ? 'bg-state-accent-active text-text-accent' : 'hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={handleModePointer}
        >
          <RiCursorLine aria-hidden className="h-4 w-4" />
        </button>
      </TipPopup>
      <TipPopup title={t('common.handMode', { ns: 'workflow' })} shortcut="workflow.hand-mode">
        <button
          type="button"
          aria-label={t('common.handMode', { ns: 'workflow' })}
          disabled={nodesReadOnly}
          className={cn(
            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
            controlMode === ControlMode.Hand ? 'bg-state-accent-active text-text-accent' : 'hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={handleModeHand}
        >
          <RiHand aria-hidden className="h-4 w-4" />
        </button>
      </TipPopup>
      {isCommentModeAvailable && (
        <TipPopup title={t('common.commentMode', { ns: 'workflow' })} shortcut="workflow.comment-mode">
          <button
            type="button"
            aria-label={t('common.commentMode', { ns: 'workflow' })}
            disabled={nodesReadOnly}
            className={cn(
              'ml-[1px] flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
              controlMode === ControlMode.Comment ? 'bg-state-accent-active text-text-accent' : 'hover:bg-state-base-hover hover:text-text-secondary',
              `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
            )}
            onClick={handleModeComment}
          >
            <Comment aria-hidden className="h-4 w-4" />
          </button>
        </TipPopup>
      )}
      <Divider className="my-1 w-3.5" />
      <TipPopup title={t('panel.organizeBlocks', { ns: 'workflow' })} shortcut="workflow.organize">
        <button
          type="button"
          aria-label={t('panel.organizeBlocks', { ns: 'workflow' })}
          disabled={nodesReadOnly}
          className={cn(
            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={handleLayout}
        >
          <RiFunctionAddLine aria-hidden className="h-4 w-4" />
        </button>
      </TipPopup>
      <TipPopup title={maximizeCanvas ? t('panel.minimize', { ns: 'workflow' }) : t('panel.maximize', { ns: 'workflow' })} shortcut="workflow.toggle-maximize">
        <button
          type="button"
          aria-label={maximizeCanvas ? t('panel.minimize', { ns: 'workflow' }) : t('panel.maximize', { ns: 'workflow' })}
          disabled={nodesReadOnly}
          className={cn(
            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary',
            maximizeCanvas ? 'bg-state-accent-active text-text-accent hover:text-text-accent' : 'hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={handleToggleMaximizeCanvas}
        >
          {maximizeCanvas && <RiAspectRatioFill aria-hidden className="h-4 w-4" />}
          {!maximizeCanvas && <RiAspectRatioLine aria-hidden className="h-4 w-4" />}
        </button>
      </TipPopup>
      <MoreActions />
    </div>
  )
}

export default memo(Control)
