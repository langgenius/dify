import type { NodeDefault } from '../../types'
import type { LoopStartNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const nodeDefault: NodeDefault<LoopStartNodeType> = {
  ...genNodeMetaData({
    sort: -1,
    type: BlockEnum.LoopStart,
  }),
  defaultValue: {},
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
