'use client'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import CreateResourceCard from '@/app/components/base/create-resource-card'
import Option from './option'

const NewDatasetCard = () => {
  const { t } = useTranslation()

  return (
    <CreateResourceCard
      footer={(
        <Option
          href="/datasets/connect"
          iconClassName="i-custom-vender-solid-development-api-connection-mod"
          text={t('connectDataset', { ns: 'dataset' })}
        />
      )}
    >
      <Option
        href="/datasets/create"
        iconClassName="i-ri-add-line"
        text={t('createDataset', { ns: 'dataset' })}
      />
      <Option
        href="/datasets/create-from-pipeline"
        iconClassName="i-ri-function-add-line"
        text={t('createFromPipeline', { ns: 'dataset' })}
      />
    </CreateResourceCard>
  )
}

NewDatasetCard.displayName = 'NewDatasetCard'

export default NewDatasetCard
