'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type Props = {
  onSetting: () => void
}

const Header: FC<Props> = ({
  onSetting,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex h-6 items-center justify-between'>
      <div className='flex items-center'>
        <div className='text-base font-medium text-gray-700'>{t(`${I18N_PREFIX}.firecrawlTitle`)}</div>
        <div className='ml-2 mr-1 w-px h-3.5 bg-gray-200'></div>
        <div
          className='p-1 rounded-md hover:bg-black/5 cursor-pointer'
          onClick={onSetting}
        >
          <Settings01 className='w-3.5 h-3.5 text-gray-500' />
        </div>
      </div>
      <a
        href='https://docs.firecrawl.dev/introduction'
        target='_blank' rel='noopener noreferrer'
        className='flex items-center text-xs text-primary-600'
      >
        <BookOpen01 className='mr-1 w-3.5 h-3.5 text-primary-600' />
        {t(`${I18N_PREFIX}.firecrawlDoc`)}
      </a>
    </div>
  )
}
export default React.memo(Header)
