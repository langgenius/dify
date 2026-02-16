import type { FC } from 'react'
import type { ProcessRuleResponse } from '@/models/datasets'
import type { RETRIEVE_METHOD } from '@/types/app'
import Image from 'next/image'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import { ProcessMode } from '@/models/datasets'
import { indexMethodIcon, retrievalIcon } from '../../../../create/icons'
import { IndexingType } from '../../../../create/step-two'
import { FieldInfo } from '../../metadata'

type RuleDetailProps = {
  sourceData?: ProcessRuleResponse
  indexingType?: IndexingType
  retrievalMethod?: RETRIEVE_METHOD
}

const getRetrievalIcon = (method?: RETRIEVE_METHOD) => {
  if (method === 'full_text_search')
    return retrievalIcon.fullText
  if (method === 'hybrid_search')
    return retrievalIcon.hybrid
  return retrievalIcon.vector
}

const RuleDetail: FC<RuleDetailProps> = React.memo(({
  sourceData,
  indexingType,
  retrievalMethod,
}) => {
  const { t } = useTranslation()

  const segmentationRuleMap = {
    mode: t('embedding.mode', { ns: 'datasetDocuments' }),
    segmentLength: t('embedding.segmentLength', { ns: 'datasetDocuments' }),
    textCleaning: t('embedding.textCleaning', { ns: 'datasetDocuments' }),
  }

  const getRuleName = useCallback((key: string) => {
    const ruleNameMap: Record<string, string> = {
      remove_extra_spaces: t('stepTwo.removeExtraSpaces', { ns: 'datasetCreation' }),
      remove_urls_emails: t('stepTwo.removeUrlEmails', { ns: 'datasetCreation' }),
      remove_stopwords: t('stepTwo.removeStopwords', { ns: 'datasetCreation' }),
    }
    return ruleNameMap[key]
  }, [t])

  const getValue = useCallback((field: string) => {
    const defaultValue = '-'

    if (!sourceData?.mode)
      return defaultValue

    const maxTokens = typeof sourceData?.rules?.segmentation?.max_tokens === 'number'
      ? sourceData.rules.segmentation.max_tokens
      : defaultValue

    const childMaxTokens = typeof sourceData?.rules?.subchunk_segmentation?.max_tokens === 'number'
      ? sourceData.rules.subchunk_segmentation.max_tokens
      : defaultValue

    const isGeneralMode = sourceData.mode === ProcessMode.general

    const fieldValueMap: Record<string, string | number> = {
      mode: isGeneralMode
        ? t('embedding.custom', { ns: 'datasetDocuments' })
        : `${t('embedding.hierarchical', { ns: 'datasetDocuments' })} · ${
          sourceData?.rules?.parent_mode === 'paragraph'
            ? t('parentMode.paragraph', { ns: 'dataset' })
            : t('parentMode.fullDoc', { ns: 'dataset' })
        }`,
      segmentLength: isGeneralMode
        ? maxTokens
        : `${t('embedding.parentMaxTokens', { ns: 'datasetDocuments' })} ${maxTokens}; ${t('embedding.childMaxTokens', { ns: 'datasetDocuments' })} ${childMaxTokens}`,
      textCleaning: sourceData?.rules?.pre_processing_rules
        ?.filter(rule => rule.enabled)
        .map(rule => getRuleName(rule.id))
        .join(',') || defaultValue,
    }

    return fieldValueMap[field] ?? defaultValue
  }, [sourceData, t, getRuleName])

  const isEconomical = indexingType === IndexingType.ECONOMICAL

  return (
    <div className="py-3">
      <div className="flex flex-col gap-y-1">
        {Object.keys(segmentationRuleMap).map(field => (
          <FieldInfo
            key={field}
            label={segmentationRuleMap[field as keyof typeof segmentationRuleMap]}
            displayedValue={String(getValue(field))}
          />
        ))}
      </div>
      <Divider type="horizontal" className="bg-divider-subtle" />
      <FieldInfo
        label={t('stepTwo.indexMode', { ns: 'datasetCreation' })}
        displayedValue={t(`stepTwo.${isEconomical ? 'economical' : 'qualified'}`, { ns: 'datasetCreation' }) as string}
        valueIcon={(
          <Image
            className="size-4"
            src={isEconomical ? indexMethodIcon.economical : indexMethodIcon.high_quality}
            alt=""
          />
        )}
      />
      <FieldInfo
        label={t('form.retrievalSetting.title', { ns: 'datasetSettings' })}
        displayedValue={t(`retrieval.${isEconomical ? 'keyword_search' : retrievalMethod ?? 'semantic_search'}.title`, { ns: 'dataset' })}
        valueIcon={(
          <Image
            className="size-4"
            src={getRetrievalIcon(retrievalMethod)}
            alt=""
          />
        )}
      />
    </div>
  )
})

RuleDetail.displayName = 'RuleDetail'

export default RuleDetail
