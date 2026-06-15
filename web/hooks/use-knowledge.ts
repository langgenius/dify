import type { I18nKeysByPrefix } from '@/types/i18n'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type IndexingTechnique = I18nKeysByPrefix<'dataset', 'indexingTechnique.'>
type IndexingMethod = I18nKeysByPrefix<'dataset', 'indexingMethod.'>

export const useKnowledge = () => {
  const { t } = useTranslation()

  const formatIndexingTechnique = useCallback((indexingTechnique: IndexingTechnique) => {
    return t(`indexingTechnique.${indexingTechnique}`, { ns: 'dataset' }) as string
  }, [t])

  const formatIndexingMethod = useCallback((indexingMethod: IndexingMethod, isEco?: boolean) => {
    if (isEco)
      return t('indexingMethod.invertedIndex', { ns: 'dataset' })

    return t(`indexingMethod.${indexingMethod}`, { ns: 'dataset' }) as string
  }, [t])

  const formatIndexingTechniqueAndMethod = useCallback((indexingTechnique: IndexingTechnique, indexingMethod: IndexingMethod) => {
    let result = formatIndexingTechnique(indexingTechnique)

    if (indexingMethod)
      result += ` · ${formatIndexingMethod(indexingMethod, indexingTechnique === 'economy')}`

    return result
  }, [formatIndexingTechnique, formatIndexingMethod])

  return {
    formatIndexingTechnique,
    formatIndexingMethod,
    formatIndexingTechniqueAndMethod,
  }
}
