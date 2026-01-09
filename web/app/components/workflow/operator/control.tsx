import type { MouseEvent } from 'react'
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
import { cn } from '@/utils/classnames'
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
  const { handleModePointer, handleModeHand } = useWorkflowMoveMode()
  const { handleLayout } = useWorkflowOrganize()
  const { handleAddNote } = useOperator()
  const {
    nodesReadOnly,
    getNodesReadOnly,
  } = useNodesReadOnly()
  const { handleToggleMaximizeCanvas } = useWorkflowCanvasMaximize()

  const addNote = (e: MouseEvent<HTMLDivElement>) => {
    if (getNodesReadOnly())
      return

    e.stopPropagation()
    handleAddNote()
  }

  return (
    <div className="pointer-events-auto flex flex-col items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary shadow-lg">
      <AddBlock />
      <TipPopup title={t('nodes.note.addNote', { ns: 'workflow' })}>
        <div
          className={cn(
            'ml-[1px] flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={addNote}
        >
          <RiStickyNoteAddLine className="h-4 w-4" />
        </div>
      </TipPopup>
      <Divider className="my-1 w-3.5" />
      <TipPopup title={t('common.pointerMode', { ns: 'workflow' })} shortcuts={['v']}>
        <div
          className={cn(
            'mr-[1px] flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
            controlMode === ControlMode.Pointer ? 'bg-state-accent-active text-text-accent' : 'hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={handleModePointer}
        >
          <RiCursorLine className="h-4 w-4" />
        </div>
      </TipPopup>
      <TipPopup title={t('common.handMode', { ns: 'workflow' })} shortcuts={['h']}>
        <div
          className={cn(
            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
            controlMode === ControlMode.Hand ? 'bg-state-accent-active text-text-accent' : 'hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={handleModeHand}
        >
          <RiHand className="h-4 w-4" />
        </div>
      </TipPopup>
      <Divider className="my-1 w-3.5" />
      <TipPopup title={t('panel.organizeBlocks', { ns: 'workflow' })} shortcuts={['ctrl', 'o']}>
        <div
          className={cn(
            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={handleLayout}
        >
          <RiFunctionAddLine className="h-4 w-4" />
        </div>
      </TipPopup>
      <TipPopup title={maximizeCanvas ? t('panel.minimize', { ns: 'workflow' }) : t('panel.maximize', { ns: 'workflow' })} shortcuts={['f']}>
        <div
          className={cn(
            'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover hover:text-text-secondary',
            maximizeCanvas ? 'bg-state-accent-active text-text-accent hover:text-text-accent' : 'hover:bg-state-base-hover hover:text-text-secondary',
            `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          )}
          onClick={handleToggleMaximizeCanvas}
        >
          {maximizeCanvas && <RiAspectRatioFill className="h-4 w-4" />}
          {!maximizeCanvas && <RiAspectRatioLine className="h-4 w-4" />}
        </div>
      </TipPopup>
      <MoreActions />
    </div>
  )
}

export default memo(Control)
