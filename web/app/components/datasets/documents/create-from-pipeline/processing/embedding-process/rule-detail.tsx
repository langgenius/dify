import type { ProcessRuleResponse } from '@/models/datasets'
import Image from 'next/image'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { indexMethodIcon, retrievalIcon } from '@/app/components/datasets/create/icons'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { FieldInfo } from '@/app/components/datasets/documents/detail/metadata'
import { ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'

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

          : sourceData.mode === ProcessMode.general
            ? (t('embedding.custom', { ns: 'datasetDocuments' }) as string)

            : `${t('embedding.hierarchical', { ns: 'datasetDocuments' })} · ${sourceData?.rules?.parent_mode === 'paragraph'
              ? t('parentMode.paragraph', { ns: 'dataset' })
              : t('parentMode.fullDoc', { ns: 'dataset' })}`
        break
    }
    return value
  }, [sourceData, t])

  return (
    <div className="flex flex-col gap-1" data-testid="rule-detail">
      <FieldInfo
        label={t('embedding.mode', { ns: 'datasetDocuments' })}
        displayedValue={getValue('mode')}
      />
      <FieldInfo
        label={t('stepTwo.indexMode', { ns: 'datasetCreation' })}
        displayedValue={t(`stepTwo.${indexingType === IndexingType.ECONOMICAL ? 'economical' : 'qualified'}`, { ns: 'datasetCreation' }) as string}
        valueIcon={(
          <Image
            className="size-4"
            src={
              indexingType === IndexingType.ECONOMICAL
                ? indexMethodIcon.economical
                : indexMethodIcon.high_quality
            }
            alt=""
          />
        )}
      />
      <FieldInfo
        label={t('form.retrievalSetting.title', { ns: 'datasetSettings' })}
        displayedValue={t(`retrieval.${indexingType === IndexingType.ECONOMICAL ? 'keyword_search' : retrievalMethod ?? 'semantic_search'}.title`, { ns: 'dataset' })}
        valueIcon={(
          <Image
            className="size-4"
            src={
              retrievalMethod === RETRIEVE_METHOD.fullText
                ? retrievalIcon.fullText

                : retrievalMethod === RETRIEVE_METHOD.hybrid
                  ? retrievalIcon.hybrid
                  : retrievalIcon.vector
            }
            alt=""
          />
        )}
      />
    </div>
  )
}

export default React.memo(RuleDetail)
