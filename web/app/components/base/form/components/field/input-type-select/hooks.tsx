import { InputVarType } from '@/app/components/workflow/types'
import { InputType } from './types'
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
  'file': 'single-file',
  'file-list': 'multi-files',
}

const INPUT_TYPE_ICON = {
  [InputVarType.textInput]: RiTextSnippet,
  [InputVarType.paragraph]: RiAlignLeft,
  [InputVarType.number]: RiHashtag,
  [InputVarType.select]: RiListCheck3,
  [InputVarType.checkbox]: RiCheckboxLine,
  [InputVarType.singleFile]: RiFileTextLine,
  [InputVarType.multiFiles]: RiFileCopy2Line,
}

const DATA_TYPE = {
  [InputVarType.textInput]: 'string',
  [InputVarType.paragraph]: 'string',
  [InputVarType.number]: 'number',
  [InputVarType.select]: 'string',
  [InputVarType.checkbox]: 'boolean',
  [InputVarType.singleFile]: 'file',
  [InputVarType.multiFiles]: 'array[file]',
}

export const useInputTypeOptions = (supportFile: boolean) => {
  const { t } = useTranslation()
  const options = supportFile ? InputType.options : InputType.exclude(['file', 'file-list']).options

  return options.map((value) => {
    return {
      value,
      label: t(`appDebug.variableConfig.${i18nFileTypeMap[value] || value}`),
      Icon: INPUT_TYPE_ICON[value],
      type: DATA_TYPE[value],
    }
  })
}
