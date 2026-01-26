'use client'

import { RiArrowRightLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type NextStepButtonProps = {
  disabled: boolean
  onClick: () => void
}

/**
 * Reusable next step button component for dataset creation flow.
 */
function NextStepButton({ disabled, onClick }: NextStepButtonProps) {
  const { t } = useTranslation()

  return (
    <div className="flex max-w-[640px] justify-end gap-2">
      <Button disabled={disabled} variant="primary" onClick={onClick}>
        <span className="flex gap-0.5 px-[10px]">
          <span className="px-0.5">{t('stepOne.button', { ns: 'datasetCreation' })}</span>
          <RiArrowRightLine className="size-4" />
        </span>
      </Button>
    </div>
  )
}

export default NextStepButton
