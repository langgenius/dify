import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type ActionsProps = {
  onBack: () => void
  onProcess: () => void
}

const Actions = ({
  onBack,
  onProcess,
}: ActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-between'>
      <Button
        variant='secondary'
        onClick={onBack}
      >
        {t('datasetPipeline.operations.dataSource')}
      </Button>
      <Button
        variant='primary'
        onClick={onProcess}
      >
        {t('datasetPipeline.operations.saveAndProcess')}
      </Button>
    </div>
  )
}

export default React.memo(Actions)
