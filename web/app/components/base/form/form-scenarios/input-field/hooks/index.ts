import { useTranslation } from 'react-i18next'
import { InputType } from '../types'
import { InputVarType } from '@/app/components/workflow/types'
import { useMemo } from 'react'

const i18nFileTypeMap: Record<string, string> = {
  'file': 'single-file',
  'file-list': 'multi-files',
}

export const useInputTypes = (supportFile: boolean) => {
  const { t } = useTranslation()
  const options = supportFile ? InputType.options : InputType.exclude(['file', 'file-list']).options

  return options.map((value) => {
    return {
      value,
      label: t(`appDebug.variableConfig.${i18nFileTypeMap[value] || value}`),
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
