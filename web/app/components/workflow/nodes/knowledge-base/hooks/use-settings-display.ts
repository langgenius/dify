import { useTranslation } from 'react-i18next'
import {
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
} from '../types'

export const useSettingsDisplay = () => {
  const { t } = useTranslation()

  return {
    [IndexMethodEnum.QUALIFIED]: t('datasetCreation.stepTwo.qualified'),
    [IndexMethodEnum.ECONOMICAL]: t('datasetSettings.form.indexMethodEconomy'),
    [RetrievalSearchMethodEnum.semantic]: t('dataset.retrieval.semantic_search.title'),
    [RetrievalSearchMethodEnum.fullText]: t('dataset.retrieval.full_text_search.title'),
    [RetrievalSearchMethodEnum.hybrid]: t('dataset.retrieval.hybrid_search.title'),
    [RetrievalSearchMethodEnum.keywordSearch]: t('dataset.retrieval.keyword_search.title'),
  }
}
