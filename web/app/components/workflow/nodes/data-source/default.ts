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
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'

const i18nPrefix = 'workflow.errorMsg'

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
  checkValid(payload, t, moreDataForCheckValid) {
    const { dataSourceInputsSchema, notAuthed } = moreDataForCheckValid
    let errorMessage = ''
    if (notAuthed)
      errorMessage = t(`${i18nPrefix}.authRequired`)

    if (!errorMessage) {
      dataSourceInputsSchema.filter((field: any) => {
        return field.required
      }).forEach((field: any) => {
        const targetVar = payload.datasource_parameters[field.variable]
        if (!targetVar) {
          errorMessage = t(`${i18nPrefix}.fieldRequired`, { field: field.label })
          return
        }
        const { type: variable_type, value } = targetVar
        if (variable_type === VarKindType.variable) {
          if (!errorMessage && (!value || value.length === 0))
            errorMessage = t(`${i18nPrefix}.fieldRequired`, { field: field.label })
        }
        else {
          if (!errorMessage && (value === undefined || value === null || value === ''))
            errorMessage = t(`${i18nPrefix}.fieldRequired`, { field: field.label })
        }
      })
    }

    return {
      isValid: !errorMessage,
      errorMessage,
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
