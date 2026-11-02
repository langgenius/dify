import type { CommonNodeType, NodeDefault } from '../../types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const metaData = genNodeMetaData({
  sort: -1,
  type: BlockEnum.IterationStart,
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
