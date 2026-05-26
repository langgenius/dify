import type { NodeDefault } from '../../types'
import type { DataSourceEmptyNodeType } from '../../nodes/data-source-empty/types'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'

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
