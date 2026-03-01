import type { DeepKeys } from '@tanstack/react-form'
import type { FormData } from './types'
import type { InputFieldConfiguration } from '@/app/components/base/form/form-scenarios/input-field/types'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import { InputFieldType } from '@/app/components/base/form/form-scenarios/input-field/types'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { PipelineInputVarType } from '@/models/pipeline'
import { useFileUploadConfig } from '@/service/use-common'
import { formatFileSize } from '@/utils/format'
import { TEXT_MAX_LENGTH } from './schema'

export const useHiddenFieldNames = (type: PipelineInputVarType) => {
  const { t } = useTranslation()
  const hiddenFieldNames = useMemo(() => {
    let fieldNames = []
    switch (type) {
      case PipelineInputVarType.textInput:
      case PipelineInputVarType.paragraph:
        fieldNames = [
          t('variableConfig.defaultValue', { ns: 'appDebug' }),
          t('variableConfig.placeholder', { ns: 'appDebug' }),
          t('variableConfig.tooltips', { ns: 'appDebug' }),
        ]
        break
      case PipelineInputVarType.number:
        fieldNames = [
          t('variableConfig.defaultValue', { ns: 'appDebug' }),
          t('variableConfig.unit', { ns: 'appDebug' }),
          t('variableConfig.placeholder', { ns: 'appDebug' }),
          t('variableConfig.tooltips', { ns: 'appDebug' }),
        ]
        break
      case PipelineInputVarType.select:
        fieldNames = [
          t('variableConfig.defaultValue', { ns: 'appDebug' }),
          t('variableConfig.tooltips', { ns: 'appDebug' }),
        ]
        break
      case PipelineInputVarType.singleFile:
        fieldNames = [
          t('variableConfig.uploadMethod', { ns: 'appDebug' }),
          t('variableConfig.tooltips', { ns: 'appDebug' }),
        ]
        break
      case PipelineInputVarType.multiFiles:
        fieldNames = [
          t('variableConfig.uploadMethod', { ns: 'appDebug' }),
          t('variableConfig.maxNumberOfUploads', { ns: 'appDebug' }),
          t('variableConfig.tooltips', { ns: 'appDebug' }),
        ]
        break
      case PipelineInputVarType.checkbox:
        fieldNames = [
          t('variableConfig.startChecked', { ns: 'appDebug' }),
          t('variableConfig.tooltips', { ns: 'appDebug' }),
        ]
        break
      default:
        fieldNames = [
          t('variableConfig.tooltips', { ns: 'appDebug' }),
        ]
    }
    return fieldNames.map(name => name.toLowerCase()).join(', ')
  }, [type, t])

  return hiddenFieldNames
}

export const useConfigurations = (props: {
  getFieldValue: (fieldName: DeepKeys<FormData>) => any
  setFieldValue: (fieldName: DeepKeys<FormData>, value: any) => void
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
      label: t('variableConfig.fieldType', { ns: 'appDebug' }),
      variable: 'type',
      required: true,
      showConditions: [],
      listeners: {
        onChange: ({ value }) => handleTypeChange(value),
      },
      supportFile,
    }, {
      type: InputFieldType.textInput,
      label: t('variableConfig.varName', { ns: 'appDebug' }),
      variable: 'variable',
      placeholder: t('variableConfig.inputPlaceholder', { ns: 'appDebug' }),
      required: true,
      listeners: {
        onBlur: ({ value }) => handleVariableNameBlur(value),
      },
      showConditions: [],
    }, {
      type: InputFieldType.textInput,
      label: t('variableConfig.displayName', { ns: 'appDebug' }),
      variable: 'label',
      placeholder: t('variableConfig.inputPlaceholder', { ns: 'appDebug' }),
      required: false,
      listeners: {
        onBlur: ({ value }) => handleDisplayNameBlur(value),
      },
      showConditions: [],
    }, {
      type: InputFieldType.numberInput,
      label: t('variableConfig.maxLength', { ns: 'appDebug' }),
      variable: 'maxLength',
      placeholder: t('variableConfig.inputPlaceholder', { ns: 'appDebug' }),
      required: true,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.textInput,
      }],
      min: 1,
      max: TEXT_MAX_LENGTH,
    }, {
      type: InputFieldType.options,
      label: t('variableConfig.options', { ns: 'appDebug' }),
      variable: 'options',
      required: true,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.select,
      }],
    }, {
      type: InputFieldType.fileTypes,
      label: t('variableConfig.file.supportFileTypes', { ns: 'appDebug' }),
      variable: 'allowedTypesAndExtensions',
      required: true,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.singleFile,
      }],
    }, {
      type: InputFieldType.fileTypes,
      label: t('variableConfig.file.supportFileTypes', { ns: 'appDebug' }),
      variable: 'allowedTypesAndExtensions',
      required: true,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.multiFiles,
      }],
    }, {
      type: InputFieldType.checkbox,
      label: t('variableConfig.required', { ns: 'appDebug' }),
      variable: 'required',
      required: true,
      showConditions: [],
    }]
  }, [t, supportFile, handleTypeChange, handleVariableNameBlur, handleDisplayNameBlur])

  return initialConfigurations
}

export const useHiddenConfigurations = (props: {
  options: string[] | undefined
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
          label: t('variableConfig.noDefaultSelected', { ns: 'appDebug' }),
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
      label: t('variableConfig.defaultValue', { ns: 'appDebug' }),
      variable: 'default',
      placeholder: t('variableConfig.defaultValuePlaceholder', { ns: 'appDebug' }),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.textInput,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.textInput,
      label: t('variableConfig.defaultValue', { ns: 'appDebug' }),
      variable: 'default',
      placeholder: t('variableConfig.defaultValuePlaceholder', { ns: 'appDebug' }),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.paragraph,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.numberInput,
      label: t('variableConfig.defaultValue', { ns: 'appDebug' }),
      variable: 'default',
      placeholder: t('variableConfig.defaultValuePlaceholder', { ns: 'appDebug' }),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.number,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.select,
      label: t('variableConfig.startSelectedOption', { ns: 'appDebug' }),
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
      label: t('variableConfig.startChecked', { ns: 'appDebug' }),
      variable: 'default',
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.checkbox,
      }],
    }, {
      type: InputFieldType.textInput,
      label: t('variableConfig.placeholder', { ns: 'appDebug' }),
      variable: 'placeholder',
      placeholder: t('variableConfig.placeholderPlaceholder', { ns: 'appDebug' }),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.textInput,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.textInput,
      label: t('variableConfig.placeholder', { ns: 'appDebug' }),
      variable: 'placeholder',
      placeholder: t('variableConfig.placeholderPlaceholder', { ns: 'appDebug' }),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.paragraph,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.textInput,
      label: t('variableConfig.unit', { ns: 'appDebug' }),
      variable: 'unit',
      placeholder: t('variableConfig.unitPlaceholder', { ns: 'appDebug' }),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.number,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.textInput,
      label: t('variableConfig.placeholder', { ns: 'appDebug' }),
      variable: 'placeholder',
      placeholder: t('variableConfig.placeholderPlaceholder', { ns: 'appDebug' }),
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.number,
      }],
      showOptional: true,
    }, {
      type: InputFieldType.uploadMethod,
      label: t('variableConfig.uploadFileTypes', { ns: 'appDebug' }),
      variable: 'allowedFileUploadMethods',
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.singleFile,
      }],
    }, {
      type: InputFieldType.uploadMethod,
      label: t('variableConfig.uploadFileTypes', { ns: 'appDebug' }),
      variable: 'allowedFileUploadMethods',
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.multiFiles,
      }],
    }, {
      type: InputFieldType.numberSlider,
      label: t('variableConfig.maxNumberOfUploads', { ns: 'appDebug' }),
      variable: 'maxLength',
      required: false,
      showConditions: [{
        variable: 'type',
        value: PipelineInputVarType.multiFiles,
      }],
      description: t('variableConfig.maxNumberTip', {
        ns: 'appDebug',
        imgLimit: formatFileSize(imgSizeLimit),
        docLimit: formatFileSize(docSizeLimit),
        audioLimit: formatFileSize(audioSizeLimit),
        videoLimit: formatFileSize(videoSizeLimit),
      }),
    }, {
      type: InputFieldType.textInput,
      label: t('variableConfig.tooltips', { ns: 'appDebug' }),
      variable: 'tooltips',
      required: false,
      showConditions: [],
      showOptional: true,
    }]
  }, [defaultSelectOptions, imgSizeLimit, docSizeLimit, audioSizeLimit, videoSizeLimit, t])

  return hiddenConfigurations
}
