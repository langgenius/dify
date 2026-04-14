'use client'
import type { FC } from 'react'
import { RiArrowRightLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'

type Props = {
  onStart: () => void
}

const NoData: FC<Props> = ({
  onStart,
}) => {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl bg-linear-to-r from-workflow-workflow-progress-bg-1 to-workflow-workflow-progress-bg-2 p-4 pt-3">
      <div className="text-xs leading-5 font-semibold text-text-secondary">{t('metadata.metadata', { ns: 'dataset' })}</div>
      <div className="mt-1 system-xs-regular text-text-tertiary">{t('metadata.documentMetadata.metadataToolTip', { ns: 'dataset' })}</div>
      <Button variant="primary" className="mt-2" onClick={onStart}>
        <div>{t('metadata.documentMetadata.startLabeling', { ns: 'dataset' })}</div>
        <RiArrowRightLine className="ml-1 size-4" />
      </Button>
    </div>
  )
}
export default React.memo(NoData)
