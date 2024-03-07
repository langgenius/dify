import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '../block-icon'
import { BlockEnum } from '../types'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { FileCheck02 } from '@/app/components/base/icons/src/vender/line/files'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'

const WorkflowInfo: FC = () => {
  const { t } = useTranslation()
  const appDetail = useAppStore(state => state.appDetail)

  if (!appDetail)
    return null

  return (
    <div className='w-[420px] h-full bg-white shadow-lg border-[0.5px] border-gray-200 rounded-2xl overflow-y-auto'>
      <div className='sticky top-0 bg-white border-b-[0.5px] border-black/5'>
        <div className='flex pt-4 px-4 pb-1'>
          <AppIcon
            className='mr-3'
            size='large'
            icon={appDetail.icon}
            background={appDetail.icon_background}
          />
          <div className='mt-2 text-base font-semibold text-gray-900'>
            {appDetail.name}
          </div>
        </div>
        <div className='px-4 py-[13px] text-xs leading-[18px] text-gray-500'>
          {appDetail.description}
        </div>
        <div className='flex items-center px-4 h-[42px] text-[13px] font-semibold text-gray-700'>
          <FileCheck02 className='mr-1 w-4 h-4' />
          {t('workflow.panel.checklist')}(2)
        </div>
      </div>
      <div className='py-2'>
        <div className='px-4 py-2 text-xs text-gray-400'>
          {t('workflow.panel.checklistTip')}
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

export default memo(WorkflowInfo)
