import type { NodeDefault } from '../../types'
import type { DataSourceNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { OUTPUT_VARIABLES_MAP } from './constants'

const metaData = genNodeMetaData({
  sort: -1,
  type: BlockEnum.DataSource,
})
const nodeDefault: NodeDefault<DataSourceNodeType> = {
  metaData,
  defaultValue: {
    datasource_parameters: {},
    datasource_configurations: {},
  },
  checkValid() {
    return {
      isValid: true,
      errorMessage: '',
    }
  },
  getOutputVars(payload) {
    const { provider_type } = payload
    const isLocalFile = provider_type === 'local_file'
    return [
      {
        variable: OUTPUT_VARIABLES_MAP.datasource_type.name,
        type: OUTPUT_VARIABLES_MAP.datasource_type.type,
      },
      ...(
        isLocalFile
          ? [
              {
                variable: OUTPUT_VARIABLES_MAP.file.name,
                type: OUTPUT_VARIABLES_MAP.file.type,
              },
          ]
          : []
      ),
    ]
  },
}

export default nodeDefault
