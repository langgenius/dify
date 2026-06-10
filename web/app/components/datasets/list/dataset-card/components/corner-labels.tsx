import type { DataSet } from '@/models/datasets'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import CornerLabel from '@/app/components/base/corner-label'

type CornerLabelsProps = {
  dataset: DataSet
}

const CornerLabels = ({ dataset }: CornerLabelsProps) => {
  const { t } = useTranslation()

  if (!dataset.embedding_available) {
    return (
      <CornerLabel
        label={t('cornerLabel.unavailable', { ns: 'dataset' })}
        className="absolute top-0 right-0 z-5"
        labelClassName="rounded-tr-xl"
      />
    )
  }

  if (dataset.runtime_mode === 'rag_pipeline') {
    return (
      <CornerLabel
        label={t('cornerLabel.pipeline', { ns: 'dataset' })}
        className="absolute top-0 right-0 z-5"
        labelClassName="rounded-tr-xl"
      />
    )
  }

  return null
}

export default React.memo(CornerLabels)
