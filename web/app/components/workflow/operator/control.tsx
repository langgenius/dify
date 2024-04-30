import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import {
  useNodesReadOnly,
  useWorkflow,
} from '../hooks'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import AddBlock from './add-block'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import {
  Cursor02C,
  Hand02,
} from '@/app/components/base/icons/src/vender/line/editor'
import {
  Cursor02C as Cursor02CSolid,
  Hand02 as Hand02Solid,
} from '@/app/components/base/icons/src/vender/solid/editor'
import { OrganizeGrid } from '@/app/components/base/icons/src/vender/line/layout'

const Control = () => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const controlMode = useStore(s => s.controlMode)
  const { handleLayout } = useWorkflow()
  const {
    nodesReadOnly,
    getNodesReadOnly,
  } = useNodesReadOnly()

  const goLayout = () => {
    if (getNodesReadOnly())
      return
    handleLayout()
  }

  return (
    <div className='flex items-center p-0.5 rounded-lg border-[0.5px] border-gray-100 bg-white shadow-lg text-gray-500'>
      <AddBlock />
      <div className='mx-[3px] w-[1px] h-3.5 bg-gray-200'></div>
      <TooltipPlus popupContent='Pointer mode'>
        <div
          className={cn(
            'flex items-center justify-center mr-[1px] w-8 h-8 rounded-lg cursor-pointer',
            controlMode === 'pointer' ? 'bg-primary-50 text-primary-600' : 'hover:bg-black/5 hover:text-gray-700',
            `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
          )}
          onClick={() => workflowStore.setState({ controlMode: 'pointer' })}
        >
          {
            controlMode === 'pointer' ? <Cursor02CSolid className='w-4 h-4' /> : <Cursor02C className='w-4 h-4' />
          }
        </div>
      </TooltipPlus>
      <TooltipPlus popupContent='Hand mode'>
        <div
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer',
            controlMode === 'hand' ? 'bg-primary-50 text-primary-600' : 'hover:bg-black/5 hover:text-gray-700',
            `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
          )}
          onClick={() => workflowStore.setState({ controlMode: 'hand' })}
        >
          {
            controlMode === 'hand' ? <Hand02Solid className='w-4 h-4' /> : <Hand02 className='w-4 h-4' />
          }
        </div>
      </TooltipPlus>
      <div className='mx-[3px] w-[1px] h-3.5 bg-gray-200'></div>
      <TooltipPlus popupContent={t('workflow.panel.organizeBlocks')}>
        <div
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg hover:bg-black/5 hover:text-gray-700 cursor-pointer',
            `${nodesReadOnly && '!cursor-not-allowed opacity-50'}`,
          )}
          onClick={goLayout}
        >
          <OrganizeGrid className='w-4 h-4' />
        </div>
      </TooltipPlus>
    </div>
  )
}

export default memo(Control)
