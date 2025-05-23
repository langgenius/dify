import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import type { CustomActionsProps } from '@/app/components/base/form/components/form/actions'

type ActionsProps = {
  formParams: CustomActionsProps
  onBack: () => void
}

const Actions = ({
  formParams,
  onBack,
}: ActionsProps) => {
  const { t } = useTranslation()
  const { form, isSubmitting, canSubmit } = formParams

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
        disabled={isSubmitting || !canSubmit}
        loading={isSubmitting}
      >
        {t('datasetPipeline.operations.process')}
      </Button>
    </div>
  )
}

export default React.memo(Actions)
