'use client'

import type { ChangeEvent, Dispatch, FocusEvent, RefObject, SetStateAction } from 'react'
import type { IConfigModalProps } from './index'
import type { Item as SelectItem } from './type-select'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/components/base/ui/toast'
import { ChangeType, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum } from '@/types/app'
import { checkKeys, getNewVarInWorkflow, replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'
import {
  applyTypeChange,
  FILE_INPUT_TYPES,
  getCheckboxDefaultSelectValue,
  isJsonSchemaEmpty,
  normalizeSelectDefaultValue,
} from './helpers'

type ConfigModalStateParams = Pick<IConfigModalProps, 'isShow' | 'onConfirm' | 'payload' | 'supportFile'>

type PayloadChangeHandler = (key: keyof InputVar) => (value: unknown) => void

export type ConfigModalState = {
  checkboxDefaultSelectValue: string
  handleConfirm: () => void
  handleJSONSchemaChange: (value: string) => null | undefined
  handlePayloadChange: PayloadChangeHandler
  handleTypeChange: (item: SelectItem) => void
  handleVarKeyBlur: (event: FocusEvent<HTMLInputElement>) => void
  handleVarNameChange: (event: ChangeEvent<HTMLInputElement>) => void
  isStringInput: boolean
  jsonSchemaStr: string
  modelId: string
  modalRef: RefObject<HTMLDivElement | null>
  selectOptions: SelectItem[]
  setTempPayload: Dispatch<SetStateAction<InputVar>>
  tempPayload: InputVar
}

export const useConfigModalState = ({
  payload,
  isShow,
  onConfirm,
  supportFile,
}: ConfigModalStateParams): ConfigModalState => {
  const { modelConfig } = useContext(ConfigContext)
  const { t } = useTranslation()
  const [tempPayload, setTempPayload] = useState<InputVar>(() => normalizeSelectDefaultValue(payload ?? getNewVarInWorkflow('')))
  const modalRef = useRef<HTMLDivElement>(null)
  const appDetail = useAppStore(state => state.appDetail)
  const isBasicApp = appDetail?.mode !== AppModeEnum.ADVANCED_CHAT && appDetail?.mode !== AppModeEnum.WORKFLOW
  const { type } = tempPayload

  useEffect(() => {
    if (isShow)
      modalRef.current?.focus()
  }, [isShow])

  const isStringInput = type === InputVarType.textInput || type === InputVarType.paragraph

  const jsonSchemaStr = useMemo(() => {
    if (type !== InputVarType.jsonObject || !tempPayload.json_schema)
      return ''

    return typeof tempPayload.json_schema === 'string'
      ? tempPayload.json_schema
      : JSON.stringify(tempPayload.json_schema, null, 2)
  }, [tempPayload.json_schema, type])

  const checkVariableName = useCallback((value: string, canBeEmpty?: boolean) => {
    const { isValid, errorMessageKey } = checkKeys([value], canBeEmpty)

    if (!isValid) {
      toast.error(t(`varKeyError.${errorMessageKey}`, {
        ns: 'appDebug',
        key: t('variableConfig.varName', { ns: 'appDebug' }),
      }))
      return false
    }

    return true
  }, [t])

  const handlePayloadChange = useCallback<PayloadChangeHandler>((key: keyof InputVar) => {
    return (value: unknown) => {
      setTempPayload((previousPayload) => {
        const nextPayload = {
          ...previousPayload,
          [key]: value,
        } as InputVar

        if (key === 'options' && previousPayload.default) {
          const options = Array.isArray(value) ? value : []
          if (!options.includes(previousPayload.default))
            nextPayload.default = undefined
        }

        return nextPayload
      })
    }
  }, [])

  const handleJSONSchemaChange = useCallback((value: string) => {
    if (value.trim() === '') {
      handlePayloadChange('json_schema')(undefined)
      return null
    }

    try {
      const parsedSchema = JSON.parse(value)
      handlePayloadChange('json_schema')(JSON.stringify(parsedSchema, null, 2))
    }
    catch {
      return null
    }
  }, [handlePayloadChange])

  const selectOptions = useMemo<SelectItem[]>(() => ([
    {
      name: t('variableConfig.text-input', { ns: 'appDebug' }),
      value: InputVarType.textInput,
    },
    {
      name: t('variableConfig.paragraph', { ns: 'appDebug' }),
      value: InputVarType.paragraph,
    },
    {
      name: t('variableConfig.select', { ns: 'appDebug' }),
      value: InputVarType.select,
    },
    {
      name: t('variableConfig.number', { ns: 'appDebug' }),
      value: InputVarType.number,
    },
    {
      name: t('variableConfig.checkbox', { ns: 'appDebug' }),
      value: InputVarType.checkbox,
    },
    ...(supportFile
      ? [
          {
            name: t('variableConfig.single-file', { ns: 'appDebug' }),
            value: InputVarType.singleFile,
          },
          {
            name: t('variableConfig.multi-files', { ns: 'appDebug' }),
            value: InputVarType.multiFiles,
          },
        ]
      : []),
    ...(!isBasicApp
      ? [
          {
            name: t('variableConfig.json', { ns: 'appDebug' }),
            value: InputVarType.jsonObject,
          },
        ]
      : []),
  ]), [isBasicApp, supportFile, t])

  const handleTypeChange = useCallback((item: SelectItem) => {
    setTempPayload(previousPayload => applyTypeChange(previousPayload, item.value))
  }, [])

  const handleVarKeyBlur = useCallback((event: FocusEvent<HTMLInputElement>) => {
    const variableName = event.target.value

    if (!checkVariableName(variableName, true) || tempPayload.label)
      return

    setTempPayload(previousPayload => ({
      ...previousPayload,
      label: variableName,
    }))
  }, [checkVariableName, tempPayload.label])

  const handleVarNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    replaceSpaceWithUnderscoreInVarNameInput(event.target)
    const value = event.target.value
    const { isValid, errorKey, errorMessageKey } = checkKeys([value], true)

    if (!isValid) {
      toast.error(t(`varKeyError.${errorMessageKey}`, { ns: 'appDebug', key: errorKey }))
      return
    }

    handlePayloadChange('variable')(value)
  }, [handlePayloadChange, t])

  const checkboxDefaultSelectValue = useMemo(() => getCheckboxDefaultSelectValue(tempPayload.default), [tempPayload.default])

  const buildMoreInfo = useCallback((): MoreInfo | undefined => {
    if (tempPayload.variable === payload?.variable)
      return undefined

    return {
      type: ChangeType.changeVarName,
      payload: {
        beforeKey: payload?.variable || '',
        afterKey: tempPayload.variable,
      },
    }
  }, [payload?.variable, tempPayload.variable])

  const validateBeforeConfirm = useCallback(() => {
    if (!checkVariableName(tempPayload.variable))
      return false

    if (!tempPayload.label) {
      toast.error(t('variableConfig.errorMsg.labelNameRequired', { ns: 'appDebug' }))
      return false
    }

    if (type === InputVarType.select) {
      if (!tempPayload.options?.length) {
        toast.error(t('variableConfig.errorMsg.atLeastOneOption', { ns: 'appDebug' }))
        return false
      }

      const duplicatedOption = tempPayload.options.find((option, index) => tempPayload.options?.indexOf(option) !== index)
      if (duplicatedOption) {
        toast.error(t('variableConfig.errorMsg.optionRepeat', { ns: 'appDebug' }))
        return false
      }
    }

    if (FILE_INPUT_TYPES.includes(type as typeof FILE_INPUT_TYPES[number])) {
      if (!tempPayload.allowed_file_types?.length) {
        toast.error(t('errorMsg.fieldRequired', {
          ns: 'workflow',
          field: t('variableConfig.file.supportFileTypes', { ns: 'appDebug' }),
        }))
        return false
      }

      if (tempPayload.allowed_file_types.includes(SupportUploadFileTypes.custom) && !tempPayload.allowed_file_extensions?.length) {
        toast.error(t('errorMsg.fieldRequired', {
          ns: 'workflow',
          field: t('variableConfig.file.custom.name', { ns: 'appDebug' }),
        }))
        return false
      }
    }

    const normalizedJsonSchema = isJsonSchemaEmpty(tempPayload.json_schema)
      ? undefined
      : tempPayload.json_schema

    if (type === InputVarType.jsonObject && typeof normalizedJsonSchema === 'string') {
      try {
        const schema = JSON.parse(normalizedJsonSchema)

        if (schema?.type !== 'object') {
          toast.error(t('variableConfig.errorMsg.jsonSchemaMustBeObject', { ns: 'appDebug' }))
          return false
        }
      }
      catch {
        toast.error(t('variableConfig.errorMsg.jsonSchemaInvalid', { ns: 'appDebug' }))
        return false
      }
    }

    return true
  }, [checkVariableName, t, tempPayload, type])

  const handleConfirm = useCallback(() => {
    if (!validateBeforeConfirm())
      return

    const payloadToSave = type === InputVarType.jsonObject && isJsonSchemaEmpty(tempPayload.json_schema)
      ? { ...tempPayload, json_schema: undefined }
      : tempPayload

    onConfirm(payloadToSave, buildMoreInfo())
  }, [buildMoreInfo, onConfirm, tempPayload, type, validateBeforeConfirm])

  return {
    checkboxDefaultSelectValue,
    handleConfirm,
    handleJSONSchemaChange,
    handlePayloadChange,
    handleTypeChange,
    handleVarKeyBlur,
    handleVarNameChange,
    isStringInput,
    jsonSchemaStr,
    modelId: modelConfig.model_id,
    modalRef,
    selectOptions,
    setTempPayload,
    tempPayload,
  }
}
