import type { NodeDefault } from '../../types'
import type { StartNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const nodeDefault: NodeDefault<StartNodeType> = {
  ...genNodeMetaData({
    sort: 0.1,
    type: BlockEnum.Start,
  }),
  defaultValue: {
    variables: [],
  },
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
