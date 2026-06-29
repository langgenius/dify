'use client'
import { RETRIEVE_METHOD } from '@/types/app'
import { retrievalIcon } from '../../create/icons'

export const getIcon = (type: RETRIEVE_METHOD) => {
  return ({
    [RETRIEVE_METHOD.semantic]: retrievalIcon.vector,
    [RETRIEVE_METHOD.fullText]: retrievalIcon.fullText,
    [RETRIEVE_METHOD.hybrid]: retrievalIcon.hybrid,
    [RETRIEVE_METHOD.invertedIndex]: retrievalIcon.vector,
    [RETRIEVE_METHOD.keywordSearch]: retrievalIcon.vector,
  })[type] || retrievalIcon.vector
}
