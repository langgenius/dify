import type { NodeDefault } from '../../types'
import type { DataSourceNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const metaData = genNodeMetaData({
  sort: -1,
  type: BlockEnum.DataSource,
})
const nodeDefault: NodeDefault<DataSourceNodeType> = {
  metaData,
  defaultValue: {},
  checkValid() {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
