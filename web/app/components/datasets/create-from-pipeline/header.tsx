import React from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import Button from '../../base/button'
import { useTranslation } from 'react-i18next'

const Header = () => {
  const { t } = useTranslation()

  return (
      <div className='system-md-semibold relative flex px-16 pb-2 pt-5 text-text-primary'>
        <span>{t('datasetPipeline.creation.title')}</span>
        <a
          className='absolute bottom-0 left-5'
          href='/datasets'
        >
          <Button variant='secondary-accent' className='size-9 rounded-full p-0'>
            <RiArrowLeftLine className='size-5 ' />
          </Button>
        </a>
      </div>
  )
}

export default React.memo(Header)
