import type { FC } from 'react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowGoBackLine,
  RiArrowGoForwardFill,
} from '@remixicon/react'
import TipPopup from '../operator/tip-popup'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import ViewWorkflowHistory from '@/app/components/workflow/header/view-workflow-history'

export type UndoRedoProps = { handleUndo: () => void; handleRedo: () => void }
const UndoRedo: FC<UndoRedoProps> = ({ handleUndo, handleRedo }) => {
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
    <div className='flex items-center p-0.5 rounded-lg border-[0.5px] border-gray-100 bg-white shadow-lg text-gray-500'>
      <TipPopup title={t('workflow.common.undo')!} >
        <div
          data-tooltip-id='workflow.undo'
          className={`
        flex items-center px-1.5 w-8 h-8 rounded-md text-[13px] font-medium 
        hover:bg-black/5 hover:text-gray-700 cursor-pointer select-none
        ${(nodesReadOnly || buttonsDisabled.undo) && 'hover:bg-transparent opacity-50 !cursor-not-allowed'}
      `}
          onClick={() => !nodesReadOnly && !buttonsDisabled.undo && handleUndo()}
        >
          <RiArrowGoBackLine className='h-4 w-4' />
        </div>
      </TipPopup>
      <TipPopup title={t('workflow.common.redo')!} >
        <div
          data-tooltip-id='workflow.redo'
          className={`
        flex items-center px-1.5 w-8 h-8 rounded-md text-[13px] font-medium 
        hover:bg-black/5 hover:text-gray-700 cursor-pointer select-none
        ${(nodesReadOnly || buttonsDisabled.redo) && 'hover:bg-transparent opacity-50 !cursor-not-allowed'}
      `}
          onClick={() => !nodesReadOnly && !buttonsDisabled.redo && handleRedo()}
        >
          <RiArrowGoForwardFill className='h-4 w-4' />
        </div>
      </TipPopup>
      <div className="mx-[3px] w-[1px] h-3.5 bg-gray-200"></div>
      <ViewWorkflowHistory />
    </div>
  )
}

export default memo(UndoRedo)
