import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type ActionsProps = {
  runDisabled?: boolean
  onProcess: () => void
}

const Actions = ({
  onProcess,
  runDisabled,
}: ActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-end'>
      <Button
        variant='primary'
        onClick={onProcess}
        disabled={runDisabled}
      >
        {t('datasetPipeline.operations.saveAndProcess')}
      </Button>
    </div>
  )
}

export default React.memo(Actions)
