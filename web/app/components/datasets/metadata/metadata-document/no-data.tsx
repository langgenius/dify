'use client'
import Button from '@/app/components/base/button'
import { RiArrowRightLine } from '@remixicon/react'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  onStart: () => void
}

const NoData: FC<Props> = ({
  onStart,
}) => {
  const { t } = useTranslation()
  return (
    <div className='rounded-xl bg-gradient-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4 pt-3'>
      <div className='text-xs font-semibold leading-5 text-text-secondary'>{t('dataset.metadata.metadata')}</div>
      <div className='system-xs-regular mt-1 text-text-tertiary'>{t('dataset.metadata.documentMetadata.metadataToolTip')}</div>
      <Button variant='primary' className='mt-2' onClick={onStart}>
        <div>{t('dataset.metadata.documentMetadata.startLabeling')}</div>
        <RiArrowRightLine className='ml-1 size-4' />
      </Button>
    </div>
  )
}
export default React.memo(NoData)
