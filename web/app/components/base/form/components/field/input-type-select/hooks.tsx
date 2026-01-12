import type { InputType } from './types'
import type { I18nKeysByPrefix } from '@/types/i18n'
import {
  RiAlignLeft,
  RiCheckboxLine,
  RiFileCopy2Line,
  RiFileTextLine,
  RiHashtag,
  RiListCheck3,
  RiTextSnippet,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { PipelineInputVarType } from '@/models/pipeline'
import { InputTypeEnum } from './types'

type VariableConfigKeySuffix = I18nKeysByPrefix<'appDebug', 'variableConfig.'>

const i18nFileTypeMap = {
  'text-input': 'text-input',
  'paragraph': 'paragraph',
  'number': 'number',
  'select': 'select',
  'checkbox': 'checkbox',
  'file': 'single-file',
  'file-list': 'multi-files',
} satisfies Record<InputType, VariableConfigKeySuffix>

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
      label: t(`variableConfig.${i18nFileTypeMap[value]}`, { ns: 'appDebug' }),
      Icon: INPUT_TYPE_ICON[value],
      type: DATA_TYPE[value],
    }
  })
}
