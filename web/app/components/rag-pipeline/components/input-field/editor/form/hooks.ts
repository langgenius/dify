import { useTranslation } from 'react-i18next'
import { InputVarType } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import type { InputFieldConfiguration } from '@/app/components/base/form/form-scenarios/input-field/types'
import { InputFieldType } from '@/app/components/base/form/form-scenarios/input-field/types'
import type { DeepKeys } from '@tanstack/react-form'
import { useFileUploadConfig } from '@/service/use-common'
import { useFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import { formatFileSize } from '@/utils/format'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import type { FormData } from './types'
import { TEXT_MAX_LENGTH } from './schema'

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

export const useConfigurations = (props: {
  type: string,
  options: string[] | undefined,
  setFieldValue: (fieldName: DeepKeys<FormData>, value: any) => void,
  supportFile: boolean
}) => {
  const { t } = useTranslation()
  const { type, options, setFieldValue, supportFile } = props

  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const {
    imgSizeLimit,
    docSizeLimit,
    audioSizeLimit,
    videoSizeLimit,
  } = useFileSizeLimit(fileUploadConfigResponse)

  const isSelectInput = type === InputVarType.select

  const defaultSelectOptions = useMemo(() => {
    if (isSelectInput && options) {
      const defaultOptions = [
        {
          value: '',
          label: t('appDebug.variableConfig.noDefaultSelected'),
        },
      ]
      const otherOptions = options.map((option: string) => ({
        value: option,
        label: option,
      }))
      return [...defaultOptions, ...otherOptions]
    }
    return []
  }, [isSelectInput, options, t])

  const handleTypeChange = useCallback((type: string) => {
    if ([InputVarType.singleFile, InputVarType.multiFiles].includes(type as InputVarType)) {
      setFieldValue('allowedFileUploadMethods', DEFAULT_FILE_UPLOAD_SETTING.allowed_file_upload_methods)
      setFieldValue('allowedTypesAndExtensions', {
        allowedFileTypes: DEFAULT_FILE_UPLOAD_SETTING.allowed_file_types,
        allowedFileExtensions: DEFAULT_FILE_UPLOAD_SETTING.allowed_file_extensions,
      })
      if (type === InputVarType.multiFiles)
        setFieldValue('maxLength', DEFAULT_FILE_UPLOAD_SETTING.max_length)
    }
    if (type === InputVarType.paragraph)
      setFieldValue('maxLength', DEFAULT_VALUE_MAX_LEN)
  }, [setFieldValue])

  const initialConfigurations = useMemo((): InputFieldConfiguration<FormData>[] => {
    return [{
      type: InputFieldType.inputTypeSelect,
      label: t('appDebug.variableConfig.fieldType'),
      variable: 'type',
      required: true,
      showConditions: [],
      listeners: {
        onChange: ({ value }) => handleTypeChange(value as string),
      },
      supportFile,
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.varName'),
      variable: 'variable',
      placeholder: t('appDebug.variableConfig.inputPlaceholder'),
      required: true,
      showConditions: [],
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.labelName'),
      variable: 'label',
      placeholder: t('appDebug.variableConfig.inputPlaceholder'),
      required: true,
      showConditions: [],
    }, {
      type: InputFieldType.numberInput,
      label: t('appDebug.variableConfig.maxLength'),
      variable: 'maxLength',
      placeholder: t('appDebug.variableConfig.inputPlaceholder'),
      required: true,
      showConditions: [{
        variable: 'type',
        value: 'text-input',
      }],
      min: 1,
      max: TEXT_MAX_LENGTH,
    }, {
      type: InputFieldType.options,
      label: t('appDebug.variableConfig.options'),
      variable: 'options',
      required: true,
      showConditions: [{
        variable: 'type',
        value: 'select',
      }],
    }, {
      type: InputFieldType.fileTypes,
      label: t('appDebug.variableConfig.file.supportFileTypes'),
      variable: 'allowedTypesAndExtensions',
      required: true,
      showConditions: [{
        variable: 'type',
        value: 'file',
      }],
    }, {
      type: InputFieldType.fileTypes,
      label: t('appDebug.variableConfig.file.supportFileTypes'),
      variable: 'allowedTypesAndExtensions',
      required: true,
      showConditions: [{
        variable: 'type',
        value: 'file-list',
      }],
    }, {
      type: InputFieldType.checkbox,
      label: t('appDebug.variableConfig.required'),
      variable: 'required',
      required: true,
      showConditions: [],
    }]
  }, [handleTypeChange, supportFile, t])

  const hiddenConfigurations = useMemo((): InputFieldConfiguration<FormData>[] => {
    return [{
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.defaultValue'),
      variable: 'default',
      placeholder: t('appDebug.variableConfig.defaultValuePlaceholder'),
      required: false,
      showConditions: [{
        variable: 'type',
        value: 'text-input',
      }],
      showOptional: true,
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.defaultValue'),
      variable: 'default',
      placeholder: t('appDebug.variableConfig.defaultValuePlaceholder'),
      required: false,
      showConditions: [{
        variable: 'type',
        value: 'number',
      }],
      showOptional: true,
    }, {
      type: InputFieldType.select,
      label: t('appDebug.variableConfig.startSelectedOption'),
      variable: 'default',
      required: false,
      showConditions: [{
        variable: 'type',
        value: 'select',
      }],
      showOptional: true,
      options: defaultSelectOptions,
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.placeholder'),
      variable: 'placeholder',
      placeholder: t('appDebug.variableConfig.placeholderPlaceholder'),
      required: false,
      showConditions: [{
        variable: 'type',
        value: 'text-input',
      }],
      showOptional: true,
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.unit'),
      variable: 'unit',
      placeholder: t('appDebug.variableConfig.unitPlaceholder'),
      required: false,
      showConditions: [{
        variable: 'type',
        value: 'number',
      }],
      showOptional: true,
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.placeholder'),
      variable: 'placeholder',
      placeholder: t('appDebug.variableConfig.placeholderPlaceholder'),
      required: false,
      showConditions: [{
        variable: 'type',
        value: 'number',
      }],
      showOptional: true,
    }, {
      type: InputFieldType.uploadMethod,
      label: t('appDebug.variableConfig.uploadFileTypes'),
      variable: 'allowedFileUploadMethods',
      required: false,
      showConditions: [{
        variable: 'type',
        value: 'file',
      }],
    }, {
      type: InputFieldType.uploadMethod,
      label: t('appDebug.variableConfig.uploadFileTypes'),
      variable: 'allowedFileUploadMethods',
      required: false,
      showConditions: [{
        variable: 'type',
        value: 'file-list',
      }],
    }, {
      type: InputFieldType.numberSlider,
      label: t('appDebug.variableConfig.maxNumberOfUploads'),
      variable: 'maxLength',
      required: false,
      showConditions: [{
        variable: 'type',
        value: 'file-list',
      }],
      description: t('appDebug.variableConfig.maxNumberTip', {
        imgLimit: formatFileSize(imgSizeLimit),
        docLimit: formatFileSize(docSizeLimit),
        audioLimit: formatFileSize(audioSizeLimit),
        videoLimit: formatFileSize(videoSizeLimit),
      }),
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.tooltips'),
      variable: 'hint',
      required: false,
      showConditions: [],
      showOptional: true,
    }]
  }, [defaultSelectOptions, imgSizeLimit, docSizeLimit, audioSizeLimit, videoSizeLimit, t])

    return {
      initialConfigurations,
      hiddenConfigurations,
    }
}
