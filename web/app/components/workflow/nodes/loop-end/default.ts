import type { NodeDefault } from '../../types'
import type {
  SimpleNodeType,
} from '@/app/components/workflow/simple-node/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Logic,
  sort: 2,
  type: BlockEnum.LoopEnd,
  isSingleton: true,
})
const nodeDefault: NodeDefault<SimpleNodeType> = {
  metaData,
  defaultValue: {},
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
