import React from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import Button from '../../base/button'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'

const Header = () => {
  const { t } = useTranslation()

  return (
    <Link
      className='system-md-semibold relative flex px-16 pb-2 pt-5 text-text-primary'
      href={'/datasets'}
      replace
    >
      <span>{t('datasetPipeline.creation.title')}</span>
      <Button
        variant='secondary-accent'
        className='absolute bottom-0 left-5 size-9 rounded-full p-0'
      >
        <RiArrowLeftLine className='size-5 ' />
      </Button>
    </Link>
  )
}

export default React.memo(Header)
