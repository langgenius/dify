import type { FC } from 'react'
import type { ProcessRuleResponse } from '@/models/datasets'
import Image from 'next/image'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldInfo } from '@/app/components/datasets/documents/detail/metadata'
import { ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import { indexMethodIcon, retrievalIcon } from '../icons'
import { IndexingType } from '../step-two'

type RuleDetailProps = {
  sourceData?: ProcessRuleResponse
  indexingType?: string
  retrievalMethod?: RETRIEVE_METHOD
}

// Lookup table for pre-processing rule names
const PRE_PROCESSING_RULE_KEYS = {
  remove_extra_spaces: 'stepTwo.removeExtraSpaces',
  remove_urls_emails: 'stepTwo.removeUrlEmails',
  remove_stopwords: 'stepTwo.removeStopwords',
} as const

// Lookup table for retrieval method icons
const RETRIEVAL_ICON_MAP: Partial<Record<RETRIEVE_METHOD, string>> = {
  [RETRIEVE_METHOD.fullText]: retrievalIcon.fullText,
  [RETRIEVE_METHOD.hybrid]: retrievalIcon.hybrid,
  [RETRIEVE_METHOD.semantic]: retrievalIcon.vector,
  [RETRIEVE_METHOD.invertedIndex]: retrievalIcon.fullText,
  [RETRIEVE_METHOD.keywordSearch]: retrievalIcon.fullText,
}

const isNumber = (value: unknown): value is number => typeof value === 'number'

const RuleDetail: FC<RuleDetailProps> = ({ sourceData, indexingType, retrievalMethod }) => {
  const { t } = useTranslation()

  const segmentationRuleLabels = {
    mode: t('embedding.mode', { ns: 'datasetDocuments' }),
    segmentLength: t('embedding.segmentLength', { ns: 'datasetDocuments' }),
    textCleaning: t('embedding.textCleaning', { ns: 'datasetDocuments' }),
  }

  const getRuleName = useCallback((key: string): string | undefined => {
    const translationKey = PRE_PROCESSING_RULE_KEYS[key as keyof typeof PRE_PROCESSING_RULE_KEYS]
    return translationKey ? t(translationKey, { ns: 'datasetCreation' }) : undefined
  }, [t])

  const getModeValue = useCallback((): string => {
    if (!sourceData?.mode)
      return '-'

    if (sourceData.mode === ProcessMode.general)
      return t('embedding.custom', { ns: 'datasetDocuments' })

    const parentModeLabel = sourceData.rules?.parent_mode === 'paragraph'
      ? t('parentMode.paragraph', { ns: 'dataset' })
      : t('parentMode.fullDoc', { ns: 'dataset' })

    return `${t('embedding.hierarchical', { ns: 'datasetDocuments' })} · ${parentModeLabel}`
  }, [sourceData, t])

  const getSegmentLengthValue = useCallback((): string | number => {
    if (!sourceData?.mode)
      return '-'

    const maxTokens = isNumber(sourceData.rules?.segmentation?.max_tokens)
      ? sourceData.rules.segmentation.max_tokens
      : '-'

    if (sourceData.mode === ProcessMode.general)
      return maxTokens

    const childMaxTokens = isNumber(sourceData.rules?.subchunk_segmentation?.max_tokens)
      ? sourceData.rules.subchunk_segmentation.max_tokens
      : '-'

    return `${t('embedding.parentMaxTokens', { ns: 'datasetDocuments' })} ${maxTokens}; ${t('embedding.childMaxTokens', { ns: 'datasetDocuments' })} ${childMaxTokens}`
  }, [sourceData, t])

  const getTextCleaningValue = useCallback((): string => {
    if (!sourceData?.mode)
      return '-'

    const enabledRules = sourceData.rules?.pre_processing_rules?.filter(rule => rule.enabled) || []
    const ruleNames = enabledRules
      .map((rule) => {
        const name = getRuleName(rule.id)
        return typeof name === 'string' ? name : ''
      })
      .filter(name => name)
    return ruleNames.length > 0 ? ruleNames.join(',') : '-'
  }, [sourceData, getRuleName])

  const fieldValueGetters: Record<string, () => string | number> = {
    mode: getModeValue,
    segmentLength: getSegmentLengthValue,
    textCleaning: getTextCleaningValue,
  }

  const isEconomical = indexingType === IndexingType.ECONOMICAL
  const indexMethodIconSrc = isEconomical ? indexMethodIcon.economical : indexMethodIcon.high_quality
  const indexModeLabel = t(`stepTwo.${isEconomical ? 'economical' : 'qualified'}`, { ns: 'datasetCreation' })

  const effectiveRetrievalMethod = isEconomical ? 'keyword_search' : (retrievalMethod ?? 'semantic_search')
  const retrievalLabel = t(`retrieval.${effectiveRetrievalMethod}.title`, { ns: 'dataset' })
  const retrievalIconSrc = RETRIEVAL_ICON_MAP[retrievalMethod as keyof typeof RETRIEVAL_ICON_MAP] ?? retrievalIcon.vector

  return (
    <div className="flex flex-col gap-1">
      {Object.keys(segmentationRuleLabels).map(field => (
        <FieldInfo
          key={field}
          label={segmentationRuleLabels[field as keyof typeof segmentationRuleLabels]}
          displayedValue={String(fieldValueGetters[field]())}
        />
      ))}
      <FieldInfo
        label={t('stepTwo.indexMode', { ns: 'datasetCreation' })}
        displayedValue={indexModeLabel}
        valueIcon={<Image className="size-4" src={indexMethodIconSrc} alt="" />}
      />
      <FieldInfo
        label={t('form.retrievalSetting.title', { ns: 'datasetSettings' })}
        displayedValue={retrievalLabel}
        valueIcon={<Image className="size-4" src={retrievalIconSrc} alt="" />}
      />
    </div>
  )
}

export default RuleDetail
