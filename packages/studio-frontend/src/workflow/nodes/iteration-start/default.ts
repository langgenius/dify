import type { NodeDefault } from '@/app/components/workflow/types'
import type { IterationStartNodeType } from '@/app/components/workflow/nodes/iteration-start/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const metaData = genNodeMetaData({
  sort: -1,
  type: BlockEnum.IterationStart,
})
const nodeDefault: NodeDefault<IterationStartNodeType> = {
  metaData,
  defaultValue: {},
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
