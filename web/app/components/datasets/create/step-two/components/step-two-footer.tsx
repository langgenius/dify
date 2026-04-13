'use client'

import type { FC } from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type StepTwoFooterProps = {
  isSetting?: boolean
  isCreating: boolean
  onPrevious: () => void
  onCreate: () => void
  onCancel?: () => void
}

export const StepTwoFooter: FC<StepTwoFooterProps> = ({
  isSetting,
  isCreating,
  onPrevious,
  onCreate,
  onCancel,
}) => {
  const { t } = useTranslation()

  if (!isSetting) {
    return (
      <div className="mt-8 flex items-center py-2">
        <Button onClick={onPrevious}>
          <RiArrowLeftLine className="mr-1 h-4 w-4" />
          {t('stepTwo.previousStep', { ns: 'datasetCreation' })}
        </Button>
        <Button
          className="ml-auto"
          loading={isCreating}
          variant="primary"
          onClick={onCreate}
        >
          {t('stepTwo.nextStep', { ns: 'datasetCreation' })}
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-8 flex items-center py-2">
      <Button
        loading={isCreating}
        variant="primary"
        onClick={onCreate}
      >
        {t('stepTwo.save', { ns: 'datasetCreation' })}
      </Button>
      <Button className="ml-2" onClick={onCancel}>
        {t('stepTwo.cancel', { ns: 'datasetCreation' })}
      </Button>
    </div>
  )
}
