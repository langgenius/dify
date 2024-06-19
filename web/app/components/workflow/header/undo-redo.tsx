import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import Tooltip from '../../base/tooltip'
import { FlipBackward, FlipForward } from '../../base/icons/src/vender/line/arrows'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import ViewWorkflowHistory from '@/app/components/workflow/header/view-workflow-history'

export type UndoRedoProps = { handleUndo: () => void; handleRedo: () => void }
const UndoRedo: FC<UndoRedoProps> = ({ handleUndo, handleRedo }) => {
  const { t } = useTranslation()

  const { nodesReadOnly } = useNodesReadOnly()

  return (
    <div className='flex items-center px-0.5 h-8 rounded-lg border-[0.5px] border-gray-200 bg-white text-gray-500 shadow-xs'>

      <Tooltip selector={'workflow.common.undo'} content={t('workflow.common.undo')!} >
        <div
          data-tooltip-id='workflow.undo'
          className={`
        flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium 
        hover:bg-black/5 hover:text-gray-700 cursor-pointer select-none
        ${nodesReadOnly && 'bg-primary-50 opacity-50 !cursor-not-allowed'}
      `}
          onClick={() => !nodesReadOnly && handleUndo()}
        >
          <FlipBackward className='h-4 w-4' />
        </div>
      </Tooltip>

      <Tooltip selector={'workflow.redo'} content={t('workflow.common.redo')!} >
        <div
          data-tooltip-id='workflow.redo'
          className={`
        flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium 
        hover:bg-black/5 hover:text-gray-700 cursor-pointer select-none
        ${nodesReadOnly && 'bg-primary-50 opacity-50 !cursor-not-allowed'}
      `}
          onClick={() => !nodesReadOnly && handleRedo()}
        >
          <FlipForward className='h-4 w-4' />

        </div>
      </Tooltip>
      <div className="mx-[3px] w-[1px] h-3.5 bg-gray-200"></div>
      <ViewWorkflowHistory />
    </div>
  )
}

export default memo(UndoRedo)
