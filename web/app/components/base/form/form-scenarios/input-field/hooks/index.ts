import { useTranslation } from 'react-i18next'
import { InputType } from '../types'
import { InputVarType } from '@/app/components/workflow/types'
import { useMemo } from 'react'
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

export const useHiddenFieldNames = (type: InputVarType) => {
  const { t } = useTranslation()
  const hiddenFieldNames = useMemo(() => {
    let fieldNames = []
    switch (type) {
      case InputVarType.textInput:
      case InputVarType.paragraph:
        fieldNames = [
          t('appDebug.variableConfig.defaultValue'),
          t('appDebug.variableConfig.placeholder'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      case InputVarType.number:
        fieldNames = [
          t('appDebug.variableConfig.defaultValue'),
          t('appDebug.variableConfig.unit'),
          t('appDebug.variableConfig.placeholder'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      case InputVarType.select:
        fieldNames = [
          t('appDebug.variableConfig.defaultValue'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      case InputVarType.singleFile:
        fieldNames = [
          t('appDebug.variableConfig.uploadMethod'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      case InputVarType.multiFiles:
        fieldNames = [
          t('appDebug.variableConfig.uploadMethod'),
          t('appDebug.variableConfig.maxNumberOfUploads'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      default:
        fieldNames = [
          t('appDebug.variableConfig.tooltips'),
        ]
    }
    return fieldNames.map(name => name.toLowerCase()).join(', ')
  }, [type, t])

  return hiddenFieldNames
}
