'use client'
import type { FC } from 'react'
import React, { useMemo } from 'react'
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
  embedding: boolean
}

export enum ProcessStatus {
  WAITING = 'waiting',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error',
}

const SegmentAdd: FC<ISegmentAddProps> = ({
  importStatus,
  clearProcessStatus,
  showNewSegmentModal,
  showBatchModal,
  embedding,
}) => {
  const { t } = useTranslation()
  const textColor = useMemo(() => {
    return embedding
      ? 'text-components-button-secondary-accent-text-disabled'
      : 'text-components-button-secondary-accent-text'
  }, [embedding])

  if (importStatus) {
    return (
      <>
        {(importStatus === ProcessStatus.WAITING || importStatus === ProcessStatus.PROCESSING) && (
          <div className='text-components-button-secondary-accent-text bg-components-progress-bar-border border-components-progress-bar-border shadow-xs shadow-shadow-shadow-3 relative mr-2 inline-flex
            items-center overflow-hidden rounded-lg border-[0.5px]
            px-2.5 py-2 backdrop-blur-[5px]'>
            <div className={cn('bg-components-progress-bar-progress border-r-components-progress-bar-progress-highlight absolute left-0 top-0 z-0 h-full border-r-[1.5px]', importStatus === ProcessStatus.WAITING ? 'w-3/12' : 'w-2/3')} />
            <RiLoader2Line className='mr-1 h-4 w-4 animate-spin' />
            <span className='system-sm-medium z-10 pr-0.5'>{t('datasetDocuments.list.batchModal.processing')}</span>
          </div>
        )}
        {importStatus === ProcessStatus.COMPLETED && (
          <div className='bg-components-panel-bg border-components-panel-border shadow-xs shadow-shadow-shadow-3 relative mr-2 inline-flex items-center overflow-hidden rounded-lg border-[0.5px] backdrop-blur-[5px]'>
            <div className='text-text-success border-r-divider-subtle inline-flex items-center border-r px-2.5 py-2'>
              <CheckCircle className='mr-1 h-4 w-4' />
              <span className='system-sm-medium pr-0.5'>{t('datasetDocuments.list.batchModal.completed')}</span>
            </div>
            <div className='m-1 inline-flex items-center'>
              <span className='system-xs-medium text-components-button-ghost-text hover:bg-components-button-ghost-bg-hover cursor-pointer rounded-md px-1.5 py-1' onClick={clearProcessStatus}>{t('datasetDocuments.list.batchModal.ok')}</span>
            </div>
            <div className='bg-dataset-chunk-process-success-bg absolute left-0 top-0 -z-10 h-full w-full opacity-40' />
          </div>
        )}
        {importStatus === ProcessStatus.ERROR && (
          <div className='bg-components-panel-bg border-components-panel-border shadow-xs shadow-shadow-shadow-3 relative mr-2 inline-flex items-center overflow-hidden rounded-lg border-[0.5px] backdrop-blur-[5px]'>
            <div className='text-text-destructive border-r-divider-subtle inline-flex items-center border-r px-2.5 py-2'>
              <RiErrorWarningFill className='mr-1 h-4 w-4' />
              <span className='system-sm-medium pr-0.5'>{t('datasetDocuments.list.batchModal.error')}</span>
            </div>
            <div className='m-1 inline-flex items-center'>
              <span className='system-xs-medium text-components-button-ghost-text hover:bg-components-button-ghost-bg-hover cursor-pointer rounded-md px-1.5 py-1' onClick={clearProcessStatus}>{t('datasetDocuments.list.batchModal.ok')}</span>
            </div>
            <div className='bg-dataset-chunk-process-error-bg absolute left-0 top-0 -z-10 h-full w-full opacity-40' />
          </div>
        )}
      </>
    )
  }

  return (
    <div className={cn(
      'border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs shadow-shadow-shadow-3 relative z-20 flex items-center rounded-lg border-[0.5px] backdrop-blur-[5px]',
      embedding && 'border-components-button-secondary-border-disabled bg-components-button-secondary-bg-disabled',
    )}>
      <button
        type='button'
        className={`border-r-divider-subtle hover:bg-state-base-hover inline-flex items-center rounded-l-lg border-r-[1px] px-2.5
          py-2 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
        onClick={showNewSegmentModal}
        disabled={embedding}
      >
        <RiAddLine className={cn('h-4 w-4', textColor)} />
        <span className={cn('ml-0.5 px-0.5 text-[13px] font-medium capitalize leading-[16px]', textColor)}>
          {t('datasetDocuments.list.action.addButton')}
        </span>
      </button>
      <Popover
        position='br'
        manualClose
        trigger='click'
        htmlContent={
          <div className='w-full p-1'>
            <button
              type='button'
              className='hover:bg-state-base-hover text-text-secondary system-md-regular flex w-full items-center rounded-lg px-2 py-1.5'
              onClick={showBatchModal}
            >
              {t('datasetDocuments.list.action.batchAdd')}
            </button>
          </div>
        }
        btnElement={
          <div className='flex items-center justify-center' >
            <RiArrowDownSLine className={cn('h-4 w-4', textColor)}/>
          </div>
        }
        btnClassName={open => cn(
          `!hover:bg-state-base-hover !rounded-l-none !rounded-r-lg !border-0 !p-2 backdrop-blur-[5px]
          disabled:cursor-not-allowed disabled:bg-transparent disabled:hover:bg-transparent`,
          open ? '!bg-state-base-hover' : '',
        )}
        popupClassName='!min-w-[128px] !bg-components-panel-bg-blur !rounded-xl border-[0.5px] !ring-0
          border-components-panel-border !shadow-xl !shadow-shadow-shadow-5 backdrop-blur-[5px]'
        className='h-fit min-w-[128px]'
        disabled={embedding}
      />
    </div>
  )
}
export default React.memo(SegmentAdd)
