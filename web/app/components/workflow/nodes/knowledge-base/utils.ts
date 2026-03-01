import {
  RetrievalSearchMethodEnum,
} from './types'

export const isHighQualitySearchMethod = (searchMethod: RetrievalSearchMethodEnum) => {
  return searchMethod === RetrievalSearchMethodEnum.semantic
    || searchMethod === RetrievalSearchMethodEnum.hybrid
    || searchMethod === RetrievalSearchMethodEnum.fullText
}
