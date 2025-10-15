import React, { useCallback } from 'react'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { ProcessMode, type ProcessRuleResponse } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { useTranslation } from 'react-i18next'
import { FieldInfo } from '@/app/components/datasets/documents/detail/metadata'
import Image from 'next/image'
import { indexMethodIcon, retrievalIcon } from '@/app/components/datasets/create/icons'

type RuleDetailProps = {
  sourceData?: ProcessRuleResponse
  indexingType?: IndexingType
  retrievalMethod?: RETRIEVE_METHOD
}

const RuleDetail = ({
  sourceData,
  indexingType,
  retrievalMethod,
}: RuleDetailProps) => {
  const { t } = useTranslation()

  const getValue = useCallback((field: string) => {
    let value = '-'
    switch (field) {
      case 'mode':
        value = !sourceData?.mode
          ? value
          // eslint-disable-next-line sonarjs/no-nested-conditional
          : sourceData.mode === ProcessMode.general
            ? (t('datasetDocuments.embedding.custom') as string)
            // eslint-disable-next-line sonarjs/no-nested-conditional
            : `${t('datasetDocuments.embedding.hierarchical')} · ${sourceData?.rules?.parent_mode === 'paragraph'
              ? t('dataset.parentMode.paragraph')
              : t('dataset.parentMode.fullDoc')}`
        break
    }
    return value
  }, [sourceData, t])

  return (
    <div className='flex flex-col gap-1'>
      <FieldInfo
        label={t('datasetDocuments.embedding.mode')}
        displayedValue={getValue('mode')}
      />
      <FieldInfo
        label={t('datasetCreation.stepTwo.indexMode')}
        displayedValue={t(`datasetCreation.stepTwo.${indexingType === IndexingType.ECONOMICAL ? 'economical' : 'qualified'}`) as string}
        valueIcon={
          <Image
            className='size-4'
            src={
              indexingType === IndexingType.ECONOMICAL
                ? indexMethodIcon.economical
                : indexMethodIcon.high_quality
            }
            alt=''
          />
        }
      />
      <FieldInfo
        label={t('datasetSettings.form.retrievalSetting.title')}
        displayedValue={t(`dataset.retrieval.${indexingType === IndexingType.ECONOMICAL ? 'keyword_search' : retrievalMethod}.title`) as string}
        valueIcon={
          <Image
            className='size-4'
            src={
              retrievalMethod === RETRIEVE_METHOD.fullText
                ? retrievalIcon.fullText
                // eslint-disable-next-line sonarjs/no-nested-conditional
                : retrievalMethod === RETRIEVE_METHOD.hybrid
                  ? retrievalIcon.hybrid
                  : retrievalIcon.vector
            }
            alt=''
          />
        }
      />
    </div>
  )
}

export default React.memo(RuleDetail)
