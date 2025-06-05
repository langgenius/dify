import type { NodeDefault } from '../../types'
import type { DataSourceNodeType } from './types'
import { DataSourceClassification } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  COMMON_OUTPUT,
  FILE_OUTPUT,
  WEBSITE_OUTPUT,
} from './constants'

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
  getOutputVars(payload, ragVars = []) {
    const {
      provider_type,
    } = payload
    const isLocalFile = provider_type === DataSourceClassification.file
    const isWebsiteCrawl = provider_type === DataSourceClassification.website
    return [
      ...COMMON_OUTPUT.map(item => ({ variable: item.name, type: item.type })),
      ...(
        isLocalFile
          ? FILE_OUTPUT.map(item => ({ variable: item.name, type: item.type }))
          : []
      ),
      ...(
        isWebsiteCrawl
          ? WEBSITE_OUTPUT.map(item => ({ variable: item.name, type: item.type }))
          : []
      ),
      ...ragVars,
    ]
  },
}

export default nodeDefault
