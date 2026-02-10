import { useTranslation } from 'react-i18next'
import {
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
} from '../types'

export const useSettingsDisplay = () => {
  const { t } = useTranslation()

  return {
    [IndexMethodEnum.QUALIFIED]: t('stepTwo.qualified', { ns: 'datasetCreation' }),
    [IndexMethodEnum.ECONOMICAL]: t('form.indexMethodEconomy', { ns: 'datasetSettings' }),
    [RetrievalSearchMethodEnum.semantic]: t('retrieval.semantic_search.title', { ns: 'dataset' }),
    [RetrievalSearchMethodEnum.fullText]: t('retrieval.full_text_search.title', { ns: 'dataset' }),
    [RetrievalSearchMethodEnum.hybrid]: t('retrieval.hybrid_search.title', { ns: 'dataset' }),
    [RetrievalSearchMethodEnum.keywordSearch]: t('retrieval.keyword_search.title', { ns: 'dataset' }),
  }
}
