'use client'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiArrowRightLine,
} from '@remixicon/react'

const CreateAppCard = (
  {
    ref,
    ..._
  },
) => {
  const { t } = useTranslation()

  return (
    <div className='bg-background-default-dimm border-components-panel-border flex min-h-[160px] flex-col rounded-xl
      border-[0.5px] transition-all duration-200 ease-in-out'
    >
      <a ref={ref} className='group flex grow cursor-pointer items-start p-4' href='/datasets/create'>
        <div className='flex items-center gap-3'>
          <div className='border-divider-regular bg-background-default-lighter group-hover:border-effects-highlight group-hover:bg-background-default-dodge flex h-10 w-10 items-center justify-center rounded-lg
            border border-dashed p-2 group-hover:border-solid'
          >
            <RiAddLine className='text-text-tertiary group-hover:text-text-accent h-4 w-4'/>
          </div>
          <div className='system-md-semibold text-text-secondary group-hover:text-text-accent'>{t('dataset.createDataset')}</div>
        </div>
      </a>
      <div className='text-text-tertiary system-xs-regular p-4 pt-0'>{t('dataset.createDatasetIntro')}</div>
      <a className='border-divider-subtle group flex cursor-pointer items-center gap-1 rounded-b-xl border-t-[0.5px] p-4' href='/datasets/connect'>
        <div className='system-xs-medium text-text-tertiary group-hover:text-text-accent'>{t('dataset.connectDataset')}</div>
        <RiArrowRightLine className='text-text-tertiary group-hover:text-text-accent h-3.5 w-3.5' />
      </a>
    </div>
  )
}

CreateAppCard.displayName = 'CreateAppCard'

export default CreateAppCard
