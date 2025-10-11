import type { NodeDefault } from '../../types'
import type { DataSourceEmptyNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const metaData = genNodeMetaData({
  sort: -1,
  type: BlockEnum.DataSourceEmpty,
  isUndeletable: true,
  isSingleton: true,
})
const nodeDefault: NodeDefault<DataSourceEmptyNodeType> = {
  metaData,
  defaultValue: {},
  checkValid() {
    return {
      isValid: true,
    }
  },
}

export default nodeDefault
