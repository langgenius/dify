import type { FC } from 'react'
import { memo } from 'react'
import BlockIcon from './block-icon'
import { BlockEnum } from './types'
import { useWorkflowContext } from './context'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { FileCheck02 } from '@/app/components/base/icons/src/vender/line/files'

const AppInfoPanel: FC = () => {
  const { selectedNode } = useWorkflowContext()

  if (selectedNode)
    return null

  return (
    <div className='absolute top-14 right-2 bottom-2 w-[420px] bg-white shadow-lg border-[0.5px] border-gray-200 rounded-2xl z-10 overflow-y-auto'>
      <div className='sticky top-0 bg-white border-b-[0.5px] border-black/5'>
        <div className='flex pt-4 px-4 pb-1'>
          <div className='mr-3 w-10 h-10'></div>
          <div className='mt-2 text-base font-semibold text-gray-900'>
            Fitness and Nutrition Expert
          </div>
        </div>
        <div className='px-4 py-[13px] text-xs leading-[18px] text-gray-500'>
          A Fitness and Nutrition Expert specializes in guiding individuals towards healthier lifestyles through exercise and diet.
        </div>
        <div className='flex items-center px-4 h-[42px] text-[13px] font-semibold text-gray-700'>
          <FileCheck02 className='mr-1 w-4 h-4' />
          Checklist(2)
        </div>
      </div>
      <div className='py-2'>
        <div className='px-4 py-2 text-xs text-gray-400'>
          Make sure all issues are resolved before publishing
        </div>
        <div className='px-4 py-2'>
          <div className='border-[0.5px] border-gray-200 bg-white shadow-xs rounded-lg'>
            <div className='flex items-center p-2 h-9 text-xs font-medium text-gray-700'>
              <BlockIcon
                type={BlockEnum.Start}
                className='mr-1.5'
              />
              Start
            </div>
            <div className='px-3 py-2 border-t-[0.5px] border-t-black/[0.02] bg-gray-25 rounded-b-lg'>
              <div className='flex text-xs leading-[18px] text-gray-500'>
                <AlertTriangle className='mt-[3px] mr-2 w-3 h-3 text-[#F79009]' />
                This step is not connected to anything
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(AppInfoPanel)
