import type { NodeDefault } from '@/app/components/workflow/types'
import type { LoopStartNodeType } from '@/app/components/workflow/nodes/loop-start/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

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
