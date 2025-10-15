import type { NodeDefault } from '../../types'
import type { DataSourceNodeType } from './types'
import { DataSourceClassification } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  COMMON_OUTPUT,
  LOCAL_FILE_OUTPUT,
} from './constants'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { getMatchedSchemaType } from '../_base/components/variable/use-match-schema-type'

const i18nPrefix = 'workflow.errorMsg'

const metaData = genNodeMetaData({
  sort: -1,
  type: BlockEnum.DataSource,
  isStart: true,
  isRequired: true,
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
  getOutputVars(payload, allPluginInfoList, ragVars = [], { schemaTypeDefinitions } = { schemaTypeDefinitions: [] }) {
    const {
      plugin_id,
      datasource_name,
      provider_type,
    } = payload

    const isLocalFile = provider_type === DataSourceClassification.localFile
    const currentDataSource = allPluginInfoList.dataSourceList?.find((ds: any) => ds.plugin_id === plugin_id)
    const currentDataSourceItem = currentDataSource?.tools?.find((tool: any) => tool.name === datasource_name)
    const output_schema = currentDataSourceItem?.output_schema
    const dynamicOutputSchema: any[] = []

    if (output_schema?.properties) {
      Object.keys(output_schema.properties).forEach((outputKey) => {
        const output = output_schema.properties[outputKey]
        const dataType = output.type
        let type = dataType === 'array'
          ? `array[${output.items?.type.slice(0, 1).toLocaleLowerCase()}${output.items?.type.slice(1)}]`
          : `${dataType.slice(0, 1).toLocaleLowerCase()}${dataType.slice(1)}`
        const schemaType = getMatchedSchemaType?.(output, schemaTypeDefinitions)

        if (type === 'object' && schemaType === 'file')
          type = 'file'

        dynamicOutputSchema.push({
          variable: outputKey,
          type,
          description: output.description,
          schemaType,
          children: output.type === 'object' ? {
            schema: {
              type: 'object',
              properties: output.properties,
            },
          } : undefined,
        })
      })
    }
    return [
      ...COMMON_OUTPUT.map(item => ({ variable: item.name, type: item.type })),
      ...(
        isLocalFile
          ? LOCAL_FILE_OUTPUT.map(item => ({ variable: item.name, type: item.type }))
          : []
      ),
      ...ragVars,
      ...dynamicOutputSchema,
    ]
  },
}

export default nodeDefault
