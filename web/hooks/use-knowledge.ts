import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export const useKnowledge = () => {
  const { t } = useTranslation()

  const formatIndexingTechnique = useCallback((indexingTechnique: string) => {
    return t(`dataset.indexingTechnique.${indexingTechnique}` as any) as string
  }, [t])

  const formatIndexingMethod = useCallback((indexingMethod: string, isEco?: boolean) => {
    if (isEco)
      return t('indexingMethod.invertedIndex', { ns: 'dataset' })

    return t(`dataset.indexingMethod.${indexingMethod}` as any) as string
  }, [t])

  const formatIndexingTechniqueAndMethod = useCallback((indexingTechnique: string, indexingMethod: string) => {
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
