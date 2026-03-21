import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

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
    <div className="flex justify-end p-4 pt-2">
      <Button disabled={disabled} variant="primary" onClick={handleNextStep}>
        <span className="px-0.5">{t('stepOne.button', { ns: 'datasetCreation' })}</span>
      </Button>
    </div>
  )
}

export default React.memo(Actions)
