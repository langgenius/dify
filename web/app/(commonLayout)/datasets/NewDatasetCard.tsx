'use client'

import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'

const CreateAppCard = forwardRef<HTMLAnchorElement>((_, ref) => {
  const { t } = useTranslation()

  return (
    <a ref={ref} className='group flex flex-col col-span-1 bg-gray-200 border-[0.5px] border-black/5 rounded-xl min-h-[160px] transition-all duration-200 ease-in-out cursor-pointer hover:bg-white hover:shadow-lg' href='/datasets/create'>
      <div className='shrink-0 flex items-center p-4 pb-3'>
        <div className='w-10 h-10 flex items-center justify-center border border-gray-200 bg-gray-100 rounded-lg'>
          <RiAddLine className='w-4 h-4 text-gray-500'/>
        </div>
        <div className='ml-3 text-sm font-semibold leading-5 text-gray-800 group-hover:text-primary-600'>{t('dataset.createDataset')}</div>
      </div>
      <div className='mb-1 px-4 text-xs leading-normal text-gray-500 line-clamp-4'>{t('dataset.createDatasetIntro')}</div>
    </a>
  )
})

CreateAppCard.displayName = 'CreateAppCard'

export default CreateAppCard
