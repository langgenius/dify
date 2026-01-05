import type { NodeDefault } from '../../types'
import type { GroupNodeData } from './types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

const metaData = genNodeMetaData({
  sort: 100,
  type: BlockEnum.Group,
})

const nodeDefault: NodeDefault<GroupNodeData> = {
  metaData,
  defaultValue: {
    members: [],
    handlers: [],
    headNodeIds: [],
    leafNodeIds: [],
  },
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
