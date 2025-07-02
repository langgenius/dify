import React from 'react'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import { useParams } from 'next/navigation'
import { RiArrowRightLine } from '@remixicon/react'
import Link from 'next/link'

type ActionsProps = {
  disabled?: boolean
  handleNextStep: () => void
}

const Actions = ({
  disabled,
  handleNextStep,
}: ActionsProps) => {
  const { t } = useTranslation()
  const { datasetId } = useParams()

  return (
    <div className='flex justify-end gap-x-2'>
      <Link
        href={`/datasets/${datasetId}/documents`}
        replace
      >
        <Button
          variant='ghost'
          className='px-3 py-2'
        >
          {t('common.operation.cancel')}
        </Button>
      </Link>
      <Button
        disabled={disabled}
        variant='primary'
        onClick={handleNextStep}
        className='gap-x-0.5'
      >
        <span className='px-0.5'>{t('datasetCreation.stepOne.button')}</span>
        <RiArrowRightLine className='size-4' />
      </Button>
    </div>
  )
}

export default React.memo(Actions)
