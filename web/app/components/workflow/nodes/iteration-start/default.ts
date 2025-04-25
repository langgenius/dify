import type { NodeDefault } from '../../types'
import type { IterationStartNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const nodeDefault: NodeDefault<IterationStartNodeType> = {
  ...genNodeMetaData({
    sort: -1,
    type: BlockEnum.IterationStart,
  }),
  defaultValue: {},
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
