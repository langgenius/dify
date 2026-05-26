import type { NodeDefault } from '../../types'
import type {
  SimpleNodeType,
} from '../../simple-node/types'
import { BlockClassificationEnum } from '../../block-selector/types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'

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
