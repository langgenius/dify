import type { FC } from 'react'
import {
  RiArrowGoBackLine,
  RiArrowGoForwardFill,
} from '@remixicon/react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ViewWorkflowHistory from '@/app/components/workflow/header/view-workflow-history'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { cn } from '@/utils/classnames'
import Divider from '../../base/divider'
import TipPopup from '../operator/tip-popup'
import { useWorkflowHistoryStore } from '../workflow-history-store'

export type UndoRedoProps = { handleUndo: () => void, handleRedo: () => void }
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
    <div className="flex items-center space-x-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-[5px]">
      <TipPopup title={t('common.undo', { ns: 'workflow' })!} shortcuts={['ctrl', 'z']}>
        <div
          data-tooltip-id="workflow.undo"
          className={
            cn('system-sm-medium flex h-8 w-8 cursor-pointer select-none items-center rounded-md px-1.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary', (nodesReadOnly || buttonsDisabled.undo)
            && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled')
          }
          onClick={() => !nodesReadOnly && !buttonsDisabled.undo && handleUndo()}
        >
          <RiArrowGoBackLine className="h-4 w-4" />
        </div>
      </TipPopup>
      <TipPopup title={t('common.redo', { ns: 'workflow' })!} shortcuts={['ctrl', 'y']}>
        <div
          data-tooltip-id="workflow.redo"
          className={
            cn('system-sm-medium flex h-8 w-8 cursor-pointer select-none items-center rounded-md px-1.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary', (nodesReadOnly || buttonsDisabled.redo)
            && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled')
          }
          onClick={() => !nodesReadOnly && !buttonsDisabled.redo && handleRedo()}
        >
          <RiArrowGoForwardFill className="h-4 w-4" />
        </div>
      </TipPopup>
      <Divider type="vertical" className="mx-0.5 h-3.5" />
      <ViewWorkflowHistory />
    </div>
  )
}

export default memo(UndoRedo)
