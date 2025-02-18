import type { FC } from 'react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowGoBackLine,
  RiArrowGoForwardFill,
} from '@remixicon/react'
import TipPopup from '../operator/tip-popup'
import { useWorkflowHistoryStore } from '../workflow-history-store'
import Divider from '../../base/divider'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import ViewWorkflowHistory from '@/app/components/workflow/header/view-workflow-history'
import classNames from '@/utils/classnames'

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
    <div className='border-components-actionbar-border bg-components-actionbar-bg flex items-center space-x-0.5 rounded-lg border-[0.5px] p-0.5 shadow-lg backdrop-blur-[5px]'>
      <TipPopup title={t('workflow.common.undo')!} shortcuts={['ctrl', 'z']}>
        <div
          data-tooltip-id='workflow.undo'
          className={
            classNames('flex items-center px-1.5 w-8 h-8 rounded-md system-sm-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary cursor-pointer select-none',
              (nodesReadOnly || buttonsDisabled.undo)
              && 'hover:bg-transparent text-text-disabled hover:text-text-disabled cursor-not-allowed')}
          onClick={() => !nodesReadOnly && !buttonsDisabled.undo && handleUndo()}
        >
          <RiArrowGoBackLine className='h-4 w-4' />
        </div>
      </TipPopup >
      <TipPopup title={t('workflow.common.redo')!} shortcuts={['ctrl', 'y']}>
        <div
          data-tooltip-id='workflow.redo'
          className={
            classNames('flex items-center px-1.5 w-8 h-8 rounded-md system-sm-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary cursor-pointer select-none',
              (nodesReadOnly || buttonsDisabled.redo)
              && 'hover:bg-transparent text-text-disabled hover:text-text-disabled cursor-not-allowed',
            )}
          onClick={() => !nodesReadOnly && !buttonsDisabled.redo && handleRedo()}
        >
          <RiArrowGoForwardFill className='h-4 w-4' />
        </div>
      </TipPopup>
      <Divider type='vertical' className="mx-0.5 h-3.5" />
      <ViewWorkflowHistory />
    </div >
  )
}

export default memo(UndoRedo)
