import type {
  DatasourceParameter,
  I18nObject,
  RagPipelineDatasourceProviderResponse,
} from '@dify/contracts/api/console/rag/types.gen'
import type { FormInputSchema } from '../nodes/_base/components/form-input-item.helpers'
import type { DataSourceNodeType } from '../nodes/data-source/types'
import type { TypeWithI18N } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { DataSourceClassification } from '../nodes/data-source/types'
import { matchDataSource } from './plugin-install-check'

const toFormLabel = (label: I18nObject): TypeWithI18N => ({
  en_US: label.en_US,
  zh_Hans: label.zh_Hans ?? label.en_US,
  ja_JP: label.ja_JP ?? label.en_US,
  pt_BR: label.pt_BR ?? label.en_US,
})

export const datasourceParametersToFormSchemas = (
  parameters: DatasourceParameter[] = [],
): FormInputSchema[] =>
  parameters.map((parameter) => {
    const types = {
      string: FormTypeEnum.textInput,
      number: FormTypeEnum.textNumber,
      boolean: FormTypeEnum.checkbox,
      select: FormTypeEnum.select,
      'secret-input': FormTypeEnum.secretInput,
      file: FormTypeEnum.file,
      files: FormTypeEnum.files,
      'system-files': FormTypeEnum.files,
    }
    return {
      name: parameter.name,
      variable: parameter.name,
      label: toFormLabel(parameter.label),
      type: types[parameter.type],
      _type: parameter.type === 'boolean' ? FormTypeEnum.boolean : types[parameter.type],
      required: parameter.required ?? false,
      default: parameter.default,
      tooltip: toFormLabel(parameter.description),
      placeholder: parameter.placeholder ? toFormLabel(parameter.placeholder) : undefined,
      min: parameter.min ?? undefined,
      max: parameter.max ?? undefined,
      scope: parameter.scope ?? undefined,
      show_on: [],
      options: parameter.options?.map((option) => ({
        label: toFormLabel(option.label),
        value: option.value,
        icon: option.icon ?? undefined,
        show_on: [],
      })),
    }
  })

export const getDataSourceCheckParams = (
  data: DataSourceNodeType,
  dataSourceList: RagPipelineDatasourceProviderResponse[],
  language: string,
) => {
  const currentDataSource = matchDataSource(dataSourceList, data)
  const datasource = currentDataSource?.declaration.datasources?.find(
    (item) => item.identity.name === data.datasource_name,
  )
  const formSchemas = datasourceParametersToFormSchemas(datasource?.parameters)
  return {
    dataSourceInputsSchema: formSchemas.map((item) => ({
      label: item.label[language] || item.label.en_US,
      variable: item.variable,
      required: item.required,
    })),
    notAuthed:
      data.provider_type !== DataSourceClassification.localFile &&
      !!currentDataSource &&
      !currentDataSource.is_authorized,
    language,
  }
}
