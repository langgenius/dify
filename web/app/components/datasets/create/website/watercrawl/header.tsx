'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiBookOpenLine, RiEqualizer2Line } from '@remixicon/react'
import Button from '@/app/components/base/button'

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
        <div className='text-base font-medium text-text-secondary'>{t(`${I18N_PREFIX}.watercrawlTitle`)}</div>
        <div className='ml-2 mr-2 w-px h-3.5 bg-divider-regular' />
        <Button className='flex items-center gap-x-[1px] h-6 px-1.5' onClick={onSetting}>
          <RiEqualizer2Line className='w-3.5 h-3.5 text-components-button-secondary-text' />
          <span className='text-components-button-secondary-text text-xs font-medium px-[3px]'>
            {t(`${I18N_PREFIX}.configureWatercrawl`)}
          </span>
        </Button>
      </div>
      <a
        href='https://docs.watercrawl.dev/'
        target='_blank'
        rel='noopener noreferrer'
        className='inline-flex items-center gap-x-1 text-xs font-medium text-text-accent'
      >
        <RiBookOpenLine className='w-3.5 h-3.5 text-text-accent' />
        <span>{t(`${I18N_PREFIX}.watercrawlDoc`)}</span>
      </a>
    </div>
  )
}
export default React.memo(Header)
