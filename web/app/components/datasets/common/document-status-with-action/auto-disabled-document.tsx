'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import StatusWithAction from './status-with-action'

type Props = {
  datasetId: string
}

const AutoDisabledDocument: FC<Props> = ({
  datasetId,
}) => {
  const { t } = useTranslation()
  const data = ['', '']
  const hasDisabledDocument = data.length > 0
  if (!hasDisabledDocument)
    return null

  return (
    <StatusWithAction
      type='info'
      description={t('dataset.documentsDisabled', { num: data.length })}
      actionText={t('dataset.enable')}
      onAction={() => { }}
    />
  )
}
export default React.memo(AutoDisabledDocument)
