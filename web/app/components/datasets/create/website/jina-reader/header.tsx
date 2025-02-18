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
        <div className='text-base font-medium text-gray-700'>{t(`${I18N_PREFIX}.jinaReaderTitle`)}</div>
        <div className='ml-2 mr-1 h-3.5 w-px bg-gray-200'></div>
        <div
          className='cursor-pointer rounded-md p-1 hover:bg-black/5'
          onClick={onSetting}
        >
          <Settings01 className='h-3.5 w-3.5 text-gray-500' />
        </div>
      </div>
      <a
        href='https://jina.ai/reader'
        target='_blank' rel='noopener noreferrer'
        className='text-primary-600 flex items-center text-xs'
      >
        <BookOpen01 className='text-primary-600 mr-1 h-3.5 w-3.5' />
        {t(`${I18N_PREFIX}.jinaReaderDoc`)}
      </a>
    </div>
  )
}
export default React.memo(Header)
