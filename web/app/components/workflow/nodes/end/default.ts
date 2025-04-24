import type { NodeDefault } from '../../types'
import type { EndNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const nodeDefault: NodeDefault<EndNodeType> = {
  ...genNodeMetaData({
    sort: 2.1,
    type: BlockEnum.End,
  }),
  defaultValue: {
    outputs: [],
  },
  checkValid() {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
