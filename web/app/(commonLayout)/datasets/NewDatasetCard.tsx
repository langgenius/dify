'use client'

import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiArrowRightLine,
} from '@remixicon/react'

const CreateAppCard = forwardRef<HTMLAnchorElement>((_, ref) => {
  const { t } = useTranslation()

  return (
    <div className='flex flex-col bg-background-default-dimm border-[0.5px] border-components-panel-border rounded-xl
      min-h-[160px] transition-all duration-200 ease-in-out'
    >
      <a ref={ref} className='group flex flex-grow items-start p-4 cursor-pointer' href='/datasets/create'>
        <div className='flex items-center gap-3'>
          <div className='w-10 h-10 p-2 flex items-center justify-center border border-dashed border-divider-regular rounded-lg
            bg-background-default-lighter group-hover:border-solid group-hover:border-effects-highlight group-hover:bg-background-default-dodge'
          >
            <RiAddLine className='w-4 h-4 text-text-tertiary group-hover:text-text-accent'/>
          </div>
          <div className='system-md-semibold text-text-secondary group-hover:text-text-accent'>{t('dataset.createDataset')}</div>
        </div>
      </a>
      <div className='p-4 pt-0 text-text-tertiary system-xs-regular'>{t('dataset.createDatasetIntro')}</div>
      <a className='group flex p-4 items-center gap-1 border-t-[0.5px] border-divider-subtle rounded-b-xl cursor-pointer' href='/datasets/connect'>
        <div className='system-xs-medium text-text-tertiary group-hover:text-text-accent'>{t('dataset.connectDataset')}</div>
        <RiArrowRightLine className='w-3.5 h-3.5 text-text-tertiary group-hover:text-text-accent' />
      </a>
    </div>
  )
})

CreateAppCard.displayName = 'CreateAppCard'

export default CreateAppCard
