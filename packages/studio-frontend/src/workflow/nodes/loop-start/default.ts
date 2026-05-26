import type { NodeDefault } from '../../types'
import type { LoopStartNodeType } from '../../nodes/loop-start/types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'

const metaData = genNodeMetaData({
  sort: -1,
  type: BlockEnum.LoopStart,
})
const nodeDefault: NodeDefault<LoopStartNodeType> = {
  metaData,
  defaultValue: {},
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
