import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type ActionsProps = {
  onProcess: () => void
}

const Actions = ({
  onProcess,
}: ActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-end'>
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
