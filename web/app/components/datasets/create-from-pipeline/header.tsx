import React, { useCallback } from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import Button from '../../base/button'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'

const Header = () => {
  const { t } = useTranslation()
  const { push } = useRouter()

  const goBack = useCallback(() => {
    push('/datasets')
  }, [push])

  return (
    <div className='system-md-semibold relative flex px-16 pb-2 pt-5 text-text-primary'>
      <span>{t('datasetPipeline.creation.title')}</span>
      <Button
        variant='secondary-accent'
        className='absolute bottom-0 left-5 size-9 rounded-full p-0'
        onClick={goBack}
      >
        <RiArrowLeftLine className='size-5 ' />
      </Button>
    </div>
  )
}

export default React.memo(Header)
