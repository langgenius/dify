import type { MouseEvent } from 'react'
import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCursorLine,
  RiFunctionAddLine,
  RiHand,
  RiStickyNoteAddLine,
} from '@remixicon/react'
import {
  useNodesReadOnly,
  useWorkflowMoveMode,
  useWorkflowOrganize,
} from '../hooks'
import {
  ControlMode,
} from '../types'
import { useStore } from '../store'
import AddBlock from './add-block'
import TipPopup from './tip-popup'
import { useOperator } from './hooks'
import cn from '@/utils/classnames'

const Control = () => {
  const { t } = useTranslation()
  const controlMode = useStore(s => s.controlMode)
  const { handleModePointer, handleModeHand } = useWorkflowMoveMode()
  const { handleLayout } = useWorkflowOrganize()
  const { handleAddNote } = useOperator()
  const {
    nodesReadOnly,
    getNodesReadOnly,
  } = useNodesReadOnly()

  const addNote = (e: MouseEvent<HTMLDivElement>) => {
    if (getNodesReadOnly())
      return

    e.stopPropagation()
    handleAddNote()
  }

  return (
    <div className='flex items-center p-0.5 rounded-lg border-[0.5px] border-gray-100 bg-white shadow-lg text-gray-500'>
      <AddBlock />
      <TipPopup title={t('workflow.nodes.note.addNote')}>
        <div
          className={cn(
            'flex items-center justify-center ml-[1px] w-8 h-8 rounded-lg hover:bg-black/5 hover:text-gray-700 cursor-pointer',
            `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
          )}
          onClick={addNote}
        >
          <RiStickyNoteAddLine className='w-4 h-4' />
        </div>
      </TipPopup>
      <div className='mx-[3px] w-[1px] h-3.5 bg-gray-200'></div>
      <TipPopup title={t('workflow.common.pointerMode')} shortcuts={['v']}>
        <div
          className={cn(
            'flex items-center justify-center mr-[1px] w-8 h-8 rounded-lg cursor-pointer',
            controlMode === ControlMode.Pointer ? 'bg-primary-50 text-primary-600' : 'hover:bg-black/5 hover:text-gray-700',
            `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
          )}
          onClick={handleModePointer}
        >
          <RiCursorLine className='w-4 h-4' />
        </div>
      </TipPopup>
      <TipPopup title={t('workflow.common.handMode')} shortcuts={['h']}>
        <div
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer',
            controlMode === ControlMode.Hand ? 'bg-primary-50 text-primary-600' : 'hover:bg-black/5 hover:text-gray-700',
            `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
          )}
          onClick={handleModeHand}
        >
          <RiHand className='w-4 h-4' />
        </div>
      </TipPopup>
      <div className='mx-[3px] w-[1px] h-3.5 bg-gray-200'></div>
      <TipPopup title={t('workflow.panel.organizeBlocks')} shortcuts={['ctrl', 'o']}>
        <div
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg hover:bg-black/5 hover:text-gray-700 cursor-pointer',
            `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
          )}
          onClick={handleLayout}
        >
          <RiFunctionAddLine className='w-4 h-4' />
        </div>
      </TipPopup>
    </div>
  )
}

export default memo(Control)
