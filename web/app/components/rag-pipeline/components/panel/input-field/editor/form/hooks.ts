import { useTranslation } from 'react-i18next'
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
import { PipelineInputVarType } from '@/models/pipeline'

export const useHiddenFieldNames = (type: PipelineInputVarType) => {
  const { t } = useTranslation()
  const hiddenFieldNames = useMemo(() => {
    let fieldNames = []
    switch (type) {
      case PipelineInputVarType.textInput:
      case PipelineInputVarType.paragraph:
        fieldNames = [
          t('appDebug.variableConfig.defaultValue'),
          t('appDebug.variableConfig.placeholder'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      case PipelineInputVarType.number:
        fieldNames = [
          t('appDebug.variableConfig.defaultValue'),
          t('appDebug.variableConfig.unit'),
          t('appDebug.variableConfig.placeholder'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      case PipelineInputVarType.select:
        fieldNames = [
          t('appDebug.variableConfig.defaultValue'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      case PipelineInputVarType.singleFile:
        fieldNames = [
          t('appDebug.variableConfig.uploadMethod'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      case PipelineInputVarType.multiFiles:
        fieldNames = [
          t('appDebug.variableConfig.uploadMethod'),
          t('appDebug.variableConfig.maxNumberOfUploads'),
          t('appDebug.variableConfig.tooltips'),
        ]
        break
      case PipelineInputVarType.checkbox:
        fieldNames = [
          t('appDebug.variableConfig.startChecked'),
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
  getFieldValue: (fieldName: DeepKeys<FormData>) => any,
  setFieldValue: (fieldName: DeepKeys<FormData>, value: any) => void,
  supportFile: boolean
}) => {
  const { t } = useTranslation()
  const { getFieldValue, setFieldValue, supportFile } = props

  const handleTypeChange = useCallback((type: PipelineInputVarType) => {
    if ([PipelineInputVarType.singleFile, PipelineInputVarType.multiFiles].includes(type)) {
      setFieldValue('allowedFileUploadMethods', DEFAULT_FILE_UPLOAD_SETTING.allowed_file_upload_methods)
      setFieldValue('allowedTypesAndExtensions', {
        allowedFileTypes: DEFAULT_FILE_UPLOAD_SETTING.allowed_file_types,
        allowedFileExtensions: DEFAULT_FILE_UPLOAD_SETTING.allowed_file_extensions,
      })
      if (type === PipelineInputVarType.multiFiles)
        setFieldValue('maxLength', DEFAULT_FILE_UPLOAD_SETTING.max_length)
    }
    if (type === PipelineInputVarType.paragraph)
      setFieldValue('maxLength', DEFAULT_VALUE_MAX_LEN)
  }, [setFieldValue])

  const handleVariableNameBlur = useCallback((value: string) => {
    const label = getFieldValue('label')
    if (!value || label)
      return
    setFieldValue('label', value)
  }, [getFieldValue, setFieldValue])

  const handleDisplayNameBlur = useCallback((value: string) => {
    if (!value)
      setFieldValue('label', getFieldValue('variable'))
  }, [getFieldValue, setFieldValue])

  const initialConfigurations = useMemo((): InputFieldConfiguration[] => {
    return [{
      type: InputFieldType.inputTypeSelect,
      label: t('appDebug.variableConfig.fieldType'),
      variable: 'type',
      required: true,
      showConditions: [],
      listeners: {
        onChange: ({ value }) => handleTypeChange(value),
      },
      supportFile,
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.varName'),
      variable: 'variable',
      placeholder: t('appDebug.variableConfig.inputPlaceholder'),
      required: true,
      listeners: {
        onBlur: ({ value }) => handleVariableNameBlur(value),
      },
      showConditions: [],
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.displayName'),
      variable: 'label',
      placeholder: t('appDebug.variableConfig.inputPlaceholder'),
      required: false,
      listeners: {
        onBlur: ({ value }) => handleDisplayNameBlur(value),
      },
      showConditions: [],
    }, {
      type: InputFieldType.numberInput,
      label: t('appDebug.variableConfig.maxLength'),
      variable: 'maxLength',
      placeholder: t('appDebug.variableConfig.inputPlaceholder'),
      required: true,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.textInput,
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
        value: PipelineInputVarType.select,
      }],
    }, {
      type: InputFieldType.fileTypes,
      label: t('appDebug.variableConfig.file.supportFileTypes'),
      variable: 'allowedTypesAndExtensions',
      required: true,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.singleFile,
      }],
    }, {
      type: InputFieldType.fileTypes,
      label: t('appDebug.variableConfig.file.supportFileTypes'),
      variable: 'allowedTypesAndExtensions',
      required: true,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.multiFiles,
      }],
    }, {
      type: InputFieldType.checkbox,
      label: t('appDebug.variableConfig.required'),
      variable: 'required',
      required: true,
      showConditions: [],
    }]
  }, [t, supportFile, handleTypeChange, handleVariableNameBlur, handleDisplayNameBlur])

  return initialConfigurations
}

export const useHiddenConfigurations = (props: {
  options: string[] | undefined,
}) => {
  const { t } = useTranslation()

  const { options } = props

  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const {
    imgSizeLimit,
    docSizeLimit,
    audioSizeLimit,
    videoSizeLimit,
  } = useFileSizeLimit(fileUploadConfigResponse)

  const defaultSelectOptions = useMemo(() => {
    if (options) {
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
  }, [options, t])

  const hiddenConfigurations = useMemo((): InputFieldConfiguration[] => {
    return [{
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.defaultValue'),
      variable: 'default',
      placeholder: t('appDebug.variableConfig.defaultValuePlaceholder'),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.textInput,
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
        value: PipelineInputVarType.paragraph,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.numberInput,
      label: t('appDebug.variableConfig.defaultValue'),
      variable: 'default',
      placeholder: t('appDebug.variableConfig.defaultValuePlaceholder'),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.number,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.select,
      label: t('appDebug.variableConfig.startSelectedOption'),
      variable: 'default',
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.select,
      }],
      showOptional: true,
      options: defaultSelectOptions,
      popupProps: {
        wrapperClassName: 'z-40',
      },
    }, {
      type: InputFieldType.checkbox,
      label: t('appDebug.variableConfig.startChecked'),
      variable: 'default',
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.checkbox,
      }],
    }, {
      type: InputFieldType.textInput,
      label: t('appDebug.variableConfig.placeholder'),
      variable: 'placeholder',
      placeholder: t('appDebug.variableConfig.placeholderPlaceholder'),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.textInput,
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
        value: PipelineInputVarType.paragraph,
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
        value: PipelineInputVarType.number,
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
        value: PipelineInputVarType.number,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.uploadMethod,
      label: t('appDebug.variableConfig.uploadFileTypes'),
      variable: 'allowedFileUploadMethods',
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.singleFile,
      }],
    }, {
      type: InputFieldType.uploadMethod,
      label: t('appDebug.variableConfig.uploadFileTypes'),
      variable: 'allowedFileUploadMethods',
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.multiFiles,
      }],
    }, {
      type: InputFieldType.numberSlider,
      label: t('appDebug.variableConfig.maxNumberOfUploads'),
      variable: 'maxLength',
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.multiFiles,
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
      variable: 'tooltips',
      required: false,
      showConditions: [],
      showOptional: true,
    }]
  }, [defaultSelectOptions, imgSizeLimit, docSizeLimit, audioSizeLimit, videoSizeLimit, t])

  return hiddenConfigurations
}
