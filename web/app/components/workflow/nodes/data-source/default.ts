import type { TFunction } from 'i18next'
import type { NodeDefault, Var } from '../../types'
import type { getDataSourceCheckParams } from '../../utils/data-source'
import type { DataSourceNodeType } from './types'
import type { SchemaTypeDefinition } from '@/service/use-common'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { matchDataSource } from '../../utils/plugin-install-check'
import { resolveVarType } from '../tool/output-schema-utils'
import { COMMON_OUTPUT, LOCAL_FILE_OUTPUT } from './constants'
import { DataSourceClassification } from './types'

const i18nPrefix = 'errorMsg'

const metaData = genNodeMetaData({
  sort: -1,
  type: BlockEnum.DataSource,
  isStart: true,
  isRequired: true,
})
const getOutputProperties = (
  schema: unknown,
  schemaTypeDefinitions?: SchemaTypeDefinition[],
): Var[] => {
  if (!schema || typeof schema !== 'object' || !('properties' in schema)) return []
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []
  return Object.entries(properties).map(([variable, value]: [string, unknown]) => {
    const schemaValue =
      value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
    const { type, schemaType } = resolveVarType(schemaValue, schemaTypeDefinitions)
    return {
      variable,
      type,
      schemaType,
      des:
        value &&
        typeof value === 'object' &&
        'description' in value &&
        typeof value.description === 'string'
          ? value.description
          : undefined,
      children: type === 'object' ? getOutputProperties(value, schemaTypeDefinitions) : undefined,
    }
  })
}

const nodeDefault: NodeDefault<DataSourceNodeType> = {
  metaData,
  defaultValue: {
    datasource_parameters: {},
    datasource_configurations: {},
  },
  checkValid(
    payload,
    t: TFunction<['workflow']>,
    moreDataForCheckValid: ReturnType<typeof getDataSourceCheckParams>,
  ) {
    const { dataSourceInputsSchema, notAuthed } = moreDataForCheckValid
    let errorMessage = ''
    if (notAuthed) errorMessage = t(($) => $[`${i18nPrefix}.authRequired`], { ns: 'workflow' })

    if (!errorMessage) {
      dataSourceInputsSchema
        .filter((field) => {
          return field.required
        })
        .forEach((field) => {
          const targetVar = payload.datasource_parameters[field.variable]
          if (!targetVar) {
            errorMessage = t(($) => $[`${i18nPrefix}.fieldRequired`], {
              ns: 'workflow',
              field: field.label,
            })
            return
          }
          const { type: variable_type, value } = targetVar
          if (variable_type === VarKindType.variable) {
            if (!errorMessage && (!value || value.length === 0))
              errorMessage = t(($) => $[`${i18nPrefix}.fieldRequired`], {
                ns: 'workflow',
                field: field.label,
              })
          } else {
            if (!errorMessage && (value === undefined || value === null || value === ''))
              errorMessage = t(($) => $[`${i18nPrefix}.fieldRequired`], {
                ns: 'workflow',
                field: field.label,
              })
          }
        })
    }

    return {
      isValid: !errorMessage,
      errorMessage,
    }
  },
  getOutputVars(
    payload,
    allPluginInfoList,
    ragVars = [],
    { schemaTypeDefinitions } = { schemaTypeDefinitions: [] },
  ) {
    const { datasource_name, provider_type } = payload
    const isLocalFile = provider_type === DataSourceClassification.localFile
    const provider = matchDataSource(allPluginInfoList.dataSourceList ?? [], payload)
    const datasource = provider?.declaration.datasources?.find(
      (item) => item.identity.name === datasource_name,
    )
    const dynamicOutputSchema = getOutputProperties(
      datasource?.output_schema,
      schemaTypeDefinitions,
    )
    return [
      ...COMMON_OUTPUT.map((item) => ({ variable: item.name, type: item.type })),
      ...(isLocalFile
        ? LOCAL_FILE_OUTPUT.map((item) => ({ variable: item.name, type: item.type }))
        : []),
      ...ragVars,
      ...dynamicOutputSchema,
    ]
  },
}

export default nodeDefault
