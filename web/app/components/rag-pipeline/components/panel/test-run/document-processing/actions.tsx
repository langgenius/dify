import React from 'react'
import Button from '@/app/components/base/button'
import type { FormType } from '@/app/components/base/form'
import { useTranslation } from 'react-i18next'

type ActionsProps = {
  form: FormType
  onBack: () => void
}

const Actions = ({
  form,
  onBack,
}: ActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-end gap-x-2 p-4 pt-2'>
      <Button
        variant='secondary'
        onClick={onBack}
      >
        {t('datasetPipeline.operations.backToDataSource')}
      </Button>
      <Button
        variant='primary'
        onClick={() => {
          form.handleSubmit()
        }}
      >
        {t('datasetPipeline.operations.process')}
      </Button>
    </div>
  )
}

export default React.memo(Actions)
