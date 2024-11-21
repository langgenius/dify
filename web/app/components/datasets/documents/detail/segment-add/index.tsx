'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiErrorWarningFill,
  RiLoader2Line,
} from '@remixicon/react'
import cn from '@/utils/classnames'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'
import Popover from '@/app/components/base/popover'

export type ISegmentAddProps = {
  importStatus: ProcessStatus | string | undefined
  clearProcessStatus: () => void
  showNewSegmentModal: () => void
  showBatchModal: () => void
}

export enum ProcessStatus {
  WAITING = 'waiting',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error',
}

// todo: Modify processing status
const SegmentAdd: FC<ISegmentAddProps> = ({
  importStatus,
  clearProcessStatus,
  showNewSegmentModal,
  showBatchModal,
}) => {
  const { t } = useTranslation()

  if (importStatus) {
    return (
      <>
        {(importStatus === ProcessStatus.WAITING || importStatus === ProcessStatus.PROCESSING) && (
          <div className='relative overflow-hidden inline-flex items-center mr-2 px-3 py-[6px] text-blue-700 bg-[#F5F8FF] rounded-lg border border-black/5'>
            {importStatus === ProcessStatus.WAITING && <div className='absolute left-0 top-0 w-3/12 h-full bg-[#D1E0FF] z-0' />}
            {importStatus === ProcessStatus.PROCESSING && <div className='absolute left-0 top-0 w-2/3 h-full bg-[#D1E0FF] z-0' />}
            <RiLoader2Line className='animate-spin mr-2 w-4 h-4' />
            <span className='font-medium text-[13px] leading-[18px] z-10'>{t('datasetDocuments.list.batchModal.processing')}</span>
          </div>
        )}
        {importStatus === ProcessStatus.COMPLETED && (
          <div className='inline-flex items-center mr-2 px-3 py-[6px] text-gray-700 bg-[#F6FEF9] rounded-lg border border-black/5'>
            <CheckCircle className='mr-2 w-4 h-4 text-[#039855]' />
            <span className='font-medium text-[13px] leading-[18px]'>{t('datasetDocuments.list.batchModal.completed')}</span>
            <span className='pl-2 font-medium text-[13px] leading-[18px] text-[#155EEF] cursor-pointer' onClick={clearProcessStatus}>{t('datasetDocuments.list.batchModal.ok')}</span>
          </div>
        )}
        {importStatus === ProcessStatus.ERROR && (
          <div className='inline-flex items-center mr-2 px-3 py-[6px] text-red-600 bg-red-100 rounded-lg border border-black/5'>
            <RiErrorWarningFill className='mr-2 w-4 h-4 text-[#D92D20]' />
            <span className='font-medium text-[13px] leading-[18px]'>{t('datasetDocuments.list.batchModal.error')}</span>
            <span className='pl-2 font-medium text-[13px] leading-[18px] text-[#155EEF] cursor-pointer' onClick={clearProcessStatus}>{t('datasetDocuments.list.batchModal.ok')}</span>
          </div>
        )}
      </>
    )
  }

  return (
    <div className='flex items-center rounded-lg border-[0.5px] border-components-button-secondary-border
      bg-components-button-secondary-bg shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] relative z-20'>
      <div
        className='inline-flex items-center px-2.5 py-2 border-r-[1px] border-r-divider-subtle cursor-pointer'
        onClick={showNewSegmentModal}
      >
        <RiAddLine className='w-4 h-4 text-components-button-secondary-accent-text' />
        <span className='text-components-button-secondary-accent-text text-[13px] leading-[16px] font-medium capitalize px-0.5 ml-0.5'>
          {t('datasetDocuments.list.action.addButton')}
        </span>
      </div>
      <Popover
        position='br'
        manualClose
        trigger='click'
        htmlContent={
          <div className='w-full p-1'>
            <div
              className='py-1.5 px-2 flex items-center hover:bg-state-base-hover rounded-lg cursor-pointer text-text-secondary system-md-regular'
              onClick={showBatchModal}
            >
              {t('datasetDocuments.list.action.batchAdd')}
            </div>
          </div>
        }
        btnElement={
          <div className='flex justify-center items-center'>
            <RiArrowDownSLine className='w-4 h-4 text-components-button-secondary-accent-text'/>
          </div>
        }
        btnClassName={open => cn('!p-2 !border-0 !rounded-l-none !rounded-r-lg !hover:bg-state-base-hover shadow-xs shadow-shadow-3 backdrop-blur-[5px]',
          open ? '!bg-state-base-hover' : '')}
        popupClassName='!min-w-[128px] !bg-components-panel-bg-blur !rounded-xl border-[0.5px] !ring-0
          border-components-panel-border !shadow-xl !shadow-shadow-shadow-5 backdrop-blur-[5px]'
        className='min-w-[128px] h-fit'
      />
    </div>
  )
}
export default React.memo(SegmentAdd)
