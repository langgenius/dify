import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import { RiArrowLeftLine } from '@remixicon/react'

type ActionsProps = {
  onBack: () => void
  runDisabled?: boolean
  onProcess: () => void
}

const Actions = ({
  onBack,
  runDisabled,
  onProcess,
}: ActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-between'>
      <Button
        variant='secondary'
        onClick={onBack}
        className='gap-x-0.5'
      >
        <RiArrowLeftLine className='size-4' />
        <span className='px-0.5'>{t('datasetPipeline.operations.dataSource')}</span>
      </Button>
      <Button
        variant='primary'
        disabled={runDisabled}
        onClick={onProcess}
      >
        {t('datasetPipeline.operations.saveAndProcess')}
      </Button>
    </div>
  )
}

export default React.memo(Actions)
