import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'

type ActionsProps = {
  disabled?: boolean
  handleNextStep: () => void
}

const Actions = ({
  disabled,
  handleNextStep,
}: ActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex justify-end p-4 pt-2'>
      <Button disabled={disabled} variant='primary' onClick={handleNextStep}>
        <span className='px-0.5'>{t('datasetCreation.stepOne.button')}</span>
      </Button>
    </div>
  )
}

export default React.memo(Actions)
