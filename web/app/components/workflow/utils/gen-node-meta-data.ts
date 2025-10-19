import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import type { BlockEnum } from '@/app/components/workflow/types'

export type GenNodeMetaDataParams = {
  classification?: BlockClassificationEnum
  sort: number
  type: BlockEnum
  title?: string
  author?: string
  helpLinkUri?: string
  isRequired?: boolean
  isUndeletable?: boolean
  isStart?: boolean
  isSingleton?: boolean
  isTypeFixed?: boolean
}
export const genNodeMetaData = ({
  classification = BlockClassificationEnum.Default,
  sort,
  type,
  title = '',
  author = 'Dify',
  helpLinkUri,
  isRequired = false,
  isUndeletable = false,
  isStart = false,
  isSingleton = false,
  isTypeFixed = false,
}: GenNodeMetaDataParams) => {
  return {
    classification,
    sort,
    type,
    title,
    author,
    helpLinkUri: helpLinkUri || type,
    isRequired,
    isUndeletable,
    isStart,
    isSingleton,
    isTypeFixed,
  }
}
