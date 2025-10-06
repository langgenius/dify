import React, { useCallback } from 'react'
import { RiArrowLeftLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { useRouter } from 'next/navigation'
import Effect from '@/app/components/base/effect'
import { useTranslation } from 'react-i18next'

type LeftHeaderProps = {
  title: string
}

const LeftHeader = ({
  title,
}: LeftHeaderProps) => {
  const { t } = useTranslation()
  const { back } = useRouter()

  const navigateBack = useCallback(() => {
    back()
  }, [back])

  return (
    <div className='relative flex flex-col gap-y-0.5 pb-2 pt-4'>
      <div className='system-2xs-semibold-uppercase bg-pipeline-add-documents-title-bg bg-clip-text text-transparent'>
        {title}
      </div>
      <div className='system-md-semibold text-text-primary'>
        {t('datasetPipeline.addDocuments.steps.processDocuments')}
      </div>
      <Button
        variant='secondary-accent'
        className='absolute -left-11 top-3.5 size-9 rounded-full p-0'
        onClick={navigateBack}
      >
        <RiArrowLeftLine className='size-5 ' />
      </Button>
      <Effect className='left-8 top-[-34px] opacity-20' />
    </div>
  )
}

export default React.memo(LeftHeader)
