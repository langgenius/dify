import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export const useKnowledge = () => {
  const { t } = useTranslation()

  const formatIndexingTechnique = useCallback((indexingTechnique: string) => {
    return t(`dataset.indexingTechnique.${indexingTechnique}`)
  }, [t])

  const formatIndexingMethod = useCallback((indexingMethod: string) => {
    return t(`dataset.indexingMethod.${indexingMethod}`)
  }, [t])

  const formatIndexingTechniqueAndMethod = useCallback((indexingTechnique: string, indexingMethod: string) => {
    let result = formatIndexingTechnique(indexingTechnique)

    if (indexingMethod)
      result += ` · ${formatIndexingMethod(indexingMethod)}`

    return result
  }, [formatIndexingTechnique, formatIndexingMethod])

  return {
    formatIndexingTechnique,
    formatIndexingMethod,
    formatIndexingTechniqueAndMethod,
  }
}
