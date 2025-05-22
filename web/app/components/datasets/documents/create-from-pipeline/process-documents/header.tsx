import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type HeaderProps = {
  onReset: () => void
  disableReset?: boolean
  onPreview?: () => void
}

const Header = ({
  onReset,
  disableReset = true,
  onPreview,
}: HeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center gap-x-1 px-4 py-2'>
      <div className='system-sm-semibold-uppercase grow text-text-secondary'>
        {t('datasetPipeline.addDocuments.stepTwo.chunkSettings')}
      </div>
      <Button variant='ghost' disabled={disableReset} onClick={onReset}>
        {t('common.operations.reset')}
      </Button>
      <Button variant='primary' onClick={onPreview}>
        {t('common.operations.reset')}
      </Button>
    </div>
  )
}

export default React.memo(Header)
