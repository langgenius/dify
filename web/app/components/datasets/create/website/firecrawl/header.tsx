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
        <div className='text-base font-medium text-text-secondary'>{t(`${I18N_PREFIX}.firecrawlTitle`)}</div>
        <div className='ml-2 mr-2 h-3.5 w-px bg-divider-regular' />
        <Button className='flex h-6 items-center gap-x-[1px] px-1.5' onClick={onSetting}>
          <RiEqualizer2Line className='h-3.5 w-3.5 text-components-button-secondary-text' />
          <span className='px-[3px] text-xs font-medium text-components-button-secondary-text'>
            {t(`${I18N_PREFIX}.configureFirecrawl`)}
          </span>
        </Button>
      </div>
      <a
        href='https://docs.firecrawl.dev/introduction'
        target='_blank'
        rel='noopener noreferrer'
        className='inline-flex items-center gap-x-1 text-xs font-medium text-text-accent'
      >
        <RiBookOpenLine className='h-3.5 w-3.5 text-text-accent' />
        <span>{t(`${I18N_PREFIX}.firecrawlDoc`)}</span>
      </a>
    </div>
  )
}
export default React.memo(Header)
