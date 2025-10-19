import type {
  InputVar,
  ToolWithProvider,
} from '../types'
import type { DataSourceNodeType } from '../nodes/data-source/types'
import { CollectionType } from '@/app/components/tools/types'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'

export const getDataSourceCheckParams = (
  toolData: DataSourceNodeType,
  dataSourceList: ToolWithProvider[],
  language: string,
) => {
  const { plugin_id, provider_type, datasource_name } = toolData
  const isBuiltIn = provider_type === CollectionType.builtIn
  const currentDataSource = dataSourceList.find(item => item.plugin_id === plugin_id)
  const currentDataSourceItem = currentDataSource?.tools.find(tool => tool.name === datasource_name)
  const formSchemas = currentDataSourceItem ? toolParametersToFormSchemas(currentDataSourceItem.parameters) : []

  return {
    dataSourceInputsSchema: (() => {
      const formInputs: InputVar[] = []
      formSchemas.forEach((item: any) => {
        formInputs.push({
          label: item.label[language] || item.label.en_US,
          variable: item.variable,
          type: item.type,
          required: item.required,
          hide: item.hide,
        })
      })
      return formInputs
    })(),
    notAuthed: isBuiltIn && !!currentDataSource?.allow_delete && !currentDataSource?.is_authorized,
    language,
  }
}
