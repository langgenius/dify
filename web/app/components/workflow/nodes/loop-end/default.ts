import type { CommonNodeType, NodeDefault } from '../../types'
import { BlockClassification } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const metaData = genNodeMetaData({
  classification: BlockClassification.Logic,
  sort: 2,
  type: BlockEnum.LoopEnd,
  isSingleton: true,
})
const nodeDefault: NodeDefault<CommonNodeType> = {
  metaData,
  defaultValue: {},
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
