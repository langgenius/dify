import { InputTypeEnum } from './types'
import { PipelineInputVarType } from '@/models/pipeline'
import { useTranslation } from 'react-i18next'
import {
  RiAlignLeft,
  RiCheckboxLine,
  RiFileCopy2Line,
  RiFileTextLine,
  RiHashtag,
  RiListCheck3,
  RiTextSnippet,
} from '@remixicon/react'

const i18nFileTypeMap: Record<string, string> = {
  'number': 'number',
  'file': 'single-file',
  'file-list': 'multi-files',
}

const INPUT_TYPE_ICON = {
  [PipelineInputVarType.textInput]: RiTextSnippet,
  [PipelineInputVarType.paragraph]: RiAlignLeft,
  [PipelineInputVarType.number]: RiHashtag,
  [PipelineInputVarType.select]: RiListCheck3,
  [PipelineInputVarType.checkbox]: RiCheckboxLine,
  [PipelineInputVarType.singleFile]: RiFileTextLine,
  [PipelineInputVarType.multiFiles]: RiFileCopy2Line,
}

const DATA_TYPE = {
  [PipelineInputVarType.textInput]: 'string',
  [PipelineInputVarType.paragraph]: 'string',
  [PipelineInputVarType.number]: 'number',
  [PipelineInputVarType.select]: 'string',
  [PipelineInputVarType.checkbox]: 'boolean',
  [PipelineInputVarType.singleFile]: 'file',
  [PipelineInputVarType.multiFiles]: 'array[file]',
}

export const useInputTypeOptions = (supportFile: boolean) => {
  const { t } = useTranslation()
  const options = supportFile ? InputTypeEnum.options : InputTypeEnum.exclude(['file', 'file-list']).options

  return options.map((value) => {
    return {
      value,
      label: t(`appDebug.variableConfig.${i18nFileTypeMap[value] || value}`),
      Icon: INPUT_TYPE_ICON[value],
      type: DATA_TYPE[value],
    }
  })
}
