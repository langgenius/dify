'use client'
import type { ChangeEvent, FC } from 'react'
import type { Item as SelectItem } from './type-select'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputVar, MoreInfo, UploadFileSetting } from '@/app/components/workflow/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useStore as useAppStore } from '@/app/components/app/store'
import Checkbox from '@/app/components/base/checkbox'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import { SimpleSelect } from '@/app/components/base/select'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import FileUploadSetting from '@/app/components/workflow/nodes/_base/components/file-upload-setting'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { ChangeType, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum, TransferMethod } from '@/types/app'
import { checkKeys, getNewVarInWorkflow, replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'
import ConfigSelect from '../config-select'
import ConfigString from '../config-string'
import ModalFoot from '../modal-foot'
import { jsonConfigPlaceHolder } from './config'
import Field from './field'
import TypeSelector from './type-select'

const TEXT_MAX_LENGTH = 256
const CHECKBOX_DEFAULT_TRUE_VALUE = 'true'
const CHECKBOX_DEFAULT_FALSE_VALUE = 'false'

const getCheckboxDefaultSelectValue = (value: InputVar['default']) => {
  if (typeof value === 'boolean')
    return value ? CHECKBOX_DEFAULT_TRUE_VALUE : CHECKBOX_DEFAULT_FALSE_VALUE
  if (typeof value === 'string')
    return value.toLowerCase() === CHECKBOX_DEFAULT_TRUE_VALUE ? CHECKBOX_DEFAULT_TRUE_VALUE : CHECKBOX_DEFAULT_FALSE_VALUE
  return CHECKBOX_DEFAULT_FALSE_VALUE
}

const parseCheckboxSelectValue = (value: string) =>
  value === CHECKBOX_DEFAULT_TRUE_VALUE

const normalizeSelectDefaultValue = (inputVar: InputVar) => {
  if (inputVar.type === InputVarType.select && inputVar.default === '')
    return { ...inputVar, default: undefined }
  return inputVar
}

export type IConfigModalProps = {
  isCreate?: boolean
  payload?: InputVar
  isShow: boolean
  varKeys?: string[]
  onClose: () => void
  onConfirm: (newValue: InputVar, moreInfo?: MoreInfo) => void
  supportFile?: boolean
}

const ConfigModal: FC<IConfigModalProps> = ({
  isCreate,
  payload,
  isShow,
  onClose,
  onConfirm,
  supportFile,
}) => {
  const { modelConfig } = useContext(ConfigContext)
  const { t } = useTranslation()
  const [tempPayload, setTempPayload] = useState<InputVar>(() => normalizeSelectDefaultValue(payload || getNewVarInWorkflow('') as any))
  const { type, label, variable, options, max_length } = tempPayload
  const modalRef = useRef<HTMLDivElement>(null)
  const appDetail = useAppStore(state => state.appDetail)
  const isBasicApp = appDetail?.mode !== AppModeEnum.ADVANCED_CHAT && appDetail?.mode !== AppModeEnum.WORKFLOW
  const jsonSchemaStr = useMemo(() => {
    const isJsonObject = type === InputVarType.jsonObject
    if (!isJsonObject || !tempPayload.json_schema)
      return ''
    try {
      return tempPayload.json_schema
    }
    catch {
      return ''
    }
  }, [tempPayload.json_schema])
  useEffect(() => {
    // To fix the first input element auto focus, then directly close modal will raise error
    if (isShow)
      modalRef.current?.focus()
  }, [isShow])

  const isStringInput = type === InputVarType.textInput || type === InputVarType.paragraph
  const checkVariableName = useCallback((value: string, canBeEmpty?: boolean) => {
    const { isValid, errorMessageKey } = checkKeys([value], canBeEmpty)
    if (!isValid) {
      Toast.notify({
        type: 'error',
        message: t(`varKeyError.${errorMessageKey}`, { ns: 'appDebug', key: t('variableConfig.varName', { ns: 'appDebug' }) }),
      })
      return false
    }
    return true
  }, [t])
  const handlePayloadChange = useCallback((key: string) => {
    return (value: any) => {
      setTempPayload((prev) => {
        const newPayload = {
          ...prev,
          [key]: value,
        }

        // Clear default value if modified options no longer include current default
        if (key === 'options' && prev.default) {
          const optionsArray = Array.isArray(value) ? value : []
          if (!optionsArray.includes(prev.default))
            newPayload.default = undefined
        }

        return newPayload
      })
    }
  }, [])

  const handleJSONSchemaChange = useCallback((value: string) => {
    const isEmpty = value == null || value.trim() === ''
    if (isEmpty) {
      handlePayloadChange('json_schema')(undefined)
      return null
    }
    try {
      const v = JSON.parse(value)
      handlePayloadChange('json_schema')(JSON.stringify(v, null, 2))
    }
    catch {
      return null
    }
  }, [handlePayloadChange])

  const selectOptions: SelectItem[] = [
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
    ...((!isBasicApp)
      ? [{
          name: t('variableConfig.json', { ns: 'appDebug' }),
          value: InputVarType.jsonObject,
        }]
      : []),
  ]

  const handleTypeChange = useCallback((item: SelectItem) => {
    const type = item.value as InputVarType

    const newPayload = produce(tempPayload, (draft) => {
      draft.type = type
      if (type === InputVarType.select)
        draft.default = undefined
      if ([InputVarType.singleFile, InputVarType.multiFiles].includes(type)) {
        (Object.keys(DEFAULT_FILE_UPLOAD_SETTING)).forEach((key) => {
          if (key !== 'max_length')
            (draft as any)[key] = (DEFAULT_FILE_UPLOAD_SETTING as any)[key]
        })
        if (type === InputVarType.multiFiles)
          draft.max_length = DEFAULT_FILE_UPLOAD_SETTING.max_length
      }
    })
    setTempPayload(newPayload)
  }, [tempPayload])

  const handleVarKeyBlur = useCallback((e: any) => {
    const varName = e.target.value
    if (!checkVariableName(varName, true) || tempPayload.label)
      return

    setTempPayload((prev) => {
      return {
        ...prev,
        label: varName,
      }
    })
  }, [checkVariableName, tempPayload.label])

  const handleVarNameChange = useCallback((e: ChangeEvent<any>) => {
    replaceSpaceWithUnderscoreInVarNameInput(e.target)
    const value = e.target.value
    const { isValid, errorKey, errorMessageKey } = checkKeys([value], true)
    if (!isValid) {
      Toast.notify({
        type: 'error',
        message: t(`varKeyError.${errorMessageKey}`, { ns: 'appDebug', key: errorKey }),
      })
      return
    }
    handlePayloadChange('variable')(e.target.value)
  }, [handlePayloadChange, t])

  const checkboxDefaultSelectValue = useMemo(() => getCheckboxDefaultSelectValue(tempPayload.default), [tempPayload.default])

  const isJsonSchemaEmpty = (value: InputVar['json_schema']) => {
    if (value === null || value === undefined) {
      return true
    }
    if (typeof value !== 'string') {
      return false
    }
    const trimmed = value.trim()
    return trimmed === ''
  }

  const handleConfirm = () => {
    const jsonSchemaValue = tempPayload.json_schema
    const isSchemaEmpty = isJsonSchemaEmpty(jsonSchemaValue)
    const normalizedJsonSchema = isSchemaEmpty ? undefined : jsonSchemaValue

    // if the input type is jsonObject and the schema is empty as determined by `isJsonSchemaEmpty`,
    // remove the `json_schema` field from the payload by setting its value to `undefined`.
    const payloadToSave = tempPayload.type === InputVarType.jsonObject && isSchemaEmpty
      ? { ...tempPayload, json_schema: undefined }
      : tempPayload

    const moreInfo = tempPayload.variable === payload?.variable
      ? undefined
      : {
          type: ChangeType.changeVarName,
          payload: { beforeKey: payload?.variable || '', afterKey: tempPayload.variable },
        }

    const isVariableNameValid = checkVariableName(tempPayload.variable)
    if (!isVariableNameValid)
      return

    if (!tempPayload.label) {
      Toast.notify({ type: 'error', message: t('variableConfig.errorMsg.labelNameRequired', { ns: 'appDebug' }) })
      return
    }
    if (isStringInput || type === InputVarType.number) {
      onConfirm(payloadToSave, moreInfo)
    }
    else if (type === InputVarType.select) {
      if (options?.length === 0) {
        Toast.notify({ type: 'error', message: t('variableConfig.errorMsg.atLeastOneOption', { ns: 'appDebug' }) })
        return
      }
      const obj: Record<string, boolean> = {}
      let hasRepeatedItem = false
      options?.forEach((o) => {
        if (obj[o]) {
          hasRepeatedItem = true
          return
        }
        obj[o] = true
      })
      if (hasRepeatedItem) {
        Toast.notify({ type: 'error', message: t('variableConfig.errorMsg.optionRepeat', { ns: 'appDebug' }) })
        return
      }
      onConfirm(payloadToSave, moreInfo)
    }
    else if ([InputVarType.singleFile, InputVarType.multiFiles].includes(type)) {
      if (tempPayload.allowed_file_types?.length === 0) {
        const errorMessages = t('errorMsg.fieldRequired', { ns: 'workflow', field: t('variableConfig.file.supportFileTypes', { ns: 'appDebug' }) })
        Toast.notify({ type: 'error', message: errorMessages })
        return
      }
      if (tempPayload.allowed_file_types?.includes(SupportUploadFileTypes.custom) && !tempPayload.allowed_file_extensions?.length) {
        const errorMessages = t('errorMsg.fieldRequired', { ns: 'workflow', field: t('variableConfig.file.custom.name', { ns: 'appDebug' }) })
        Toast.notify({ type: 'error', message: errorMessages })
        return
      }
      onConfirm(payloadToSave, moreInfo)
    }
    else if (type === InputVarType.jsonObject) {
      if (!isSchemaEmpty && typeof normalizedJsonSchema === 'string') {
        try {
          const schema = JSON.parse(normalizedJsonSchema)
          if (schema?.type !== 'object') {
            Toast.notify({ type: 'error', message: t('variableConfig.errorMsg.jsonSchemaMustBeObject', { ns: 'appDebug' }) })
            return
          }
        }
        catch {
          Toast.notify({ type: 'error', message: t('variableConfig.errorMsg.jsonSchemaInvalid', { ns: 'appDebug' }) })
          return
        }
      }
      onConfirm(payloadToSave, moreInfo)
    }
    else {
      onConfirm(payloadToSave, moreInfo)
    }
  }

  return (
    <Modal
      title={t(`variableConfig.${isCreate ? 'addModalTitle' : 'editModalTitle'}`, { ns: 'appDebug' })}
      isShow={isShow}
      onClose={onClose}
    >
      <div className="mb-8" ref={modalRef} tabIndex={-1}>
        <div className="space-y-2">
          <Field title={t('variableConfig.fieldType', { ns: 'appDebug' })}>
            <TypeSelector value={type} items={selectOptions} onSelect={handleTypeChange} />
          </Field>

          <Field title={t('variableConfig.varName', { ns: 'appDebug' })}>
            <Input
              value={variable}
              onChange={handleVarNameChange}
              onBlur={handleVarKeyBlur}
              placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })!}
            />
          </Field>
          <Field title={t('variableConfig.labelName', { ns: 'appDebug' })}>
            <Input
              value={label as string}
              onChange={e => handlePayloadChange('label')(e.target.value)}
              placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })!}
            />
          </Field>

          {isStringInput && (
            <Field title={t('variableConfig.maxLength', { ns: 'appDebug' })}>
              <ConfigString maxLength={type === InputVarType.textInput ? TEXT_MAX_LENGTH : Infinity} modelId={modelConfig.model_id} value={max_length} onChange={handlePayloadChange('max_length')} />
            </Field>

          )}

          {/* Default value for text input */}
          {type === InputVarType.textInput && (
            <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
              <Input
                value={tempPayload.default || ''}
                onChange={e => handlePayloadChange('default')(e.target.value || undefined)}
                placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })!}
              />
            </Field>
          )}

          {/* Default value for paragraph */}
          {type === InputVarType.paragraph && (
            <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
              <Textarea
                value={String(tempPayload.default ?? '')}
                onChange={e => handlePayloadChange('default')(e.target.value || undefined)}
                placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })!}
              />
            </Field>
          )}

          {/* Default value for number input */}
          {type === InputVarType.number && (
            <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
              <Input
                type="number"
                value={tempPayload.default || ''}
                onChange={e => handlePayloadChange('default')(e.target.value || undefined)}
                placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })!}
              />
            </Field>
          )}

          {type === InputVarType.checkbox && (
            <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
              <SimpleSelect
                className="w-full"
                optionWrapClassName="max-h-[140px] overflow-y-auto"
                items={[
                  { value: CHECKBOX_DEFAULT_TRUE_VALUE, name: t('variableConfig.startChecked', { ns: 'appDebug' }) },
                  { value: CHECKBOX_DEFAULT_FALSE_VALUE, name: t('variableConfig.noDefaultSelected', { ns: 'appDebug' }) },
                ]}
                defaultValue={checkboxDefaultSelectValue}
                onSelect={item => handlePayloadChange('default')(parseCheckboxSelectValue(String(item.value)))}
                placeholder={t('variableConfig.selectDefaultValue', { ns: 'appDebug' })}
                allowSearch={false}
              />
            </Field>
          )}

          {type === InputVarType.select && (
            <>
              <Field title={t('variableConfig.options', { ns: 'appDebug' })}>
                <ConfigSelect options={options || []} onChange={handlePayloadChange('options')} />
              </Field>
              {options && options.length > 0 && (
                <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
                  <SimpleSelect
                    key={`default-select-${options.join('-')}`}
                    className="w-full"
                    optionWrapClassName="max-h-[140px] overflow-y-auto"
                    items={[
                      { value: '', name: t('variableConfig.noDefaultValue', { ns: 'appDebug' }) },
                      ...options.filter(opt => opt.trim() !== '').map(option => ({
                        value: option,
                        name: option,
                      })),
                    ]}
                    defaultValue={tempPayload.default || ''}
                    onSelect={item => handlePayloadChange('default')(item.value === '' ? undefined : item.value)}
                    placeholder={t('variableConfig.selectDefaultValue', { ns: 'appDebug' })}
                    allowSearch={false}
                  />
                </Field>
              )}
            </>
          )}

          {[InputVarType.singleFile, InputVarType.multiFiles].includes(type) && (
            <>
              <FileUploadSetting
                payload={tempPayload as UploadFileSetting}
                onChange={(p: UploadFileSetting) => setTempPayload(p as InputVar)}
                isMultiple={type === InputVarType.multiFiles}
              />
              <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
                <FileUploaderInAttachmentWrapper
                  value={(type === InputVarType.singleFile ? (tempPayload.default ? [tempPayload.default] : []) : (tempPayload.default || [])) as unknown as FileEntity[]}
                  onChange={(files) => {
                    if (type === InputVarType.singleFile)
                      handlePayloadChange('default')(files?.[0] || undefined)
                    else
                      handlePayloadChange('default')(files || undefined)
                  }}
                  fileConfig={{
                    allowed_file_types: tempPayload.allowed_file_types || [SupportUploadFileTypes.document],
                    allowed_file_extensions: tempPayload.allowed_file_extensions || [],
                    allowed_file_upload_methods: tempPayload.allowed_file_upload_methods || [TransferMethod.remote_url],
                    number_limits: type === InputVarType.singleFile ? 1 : tempPayload.max_length || 5,
                  }}
                />
              </Field>
            </>
          )}

          {type === InputVarType.jsonObject && (
            <Field title={t('variableConfig.jsonSchema', { ns: 'appDebug' })} isOptional>
              <CodeEditor
                language={CodeLanguage.json}
                value={jsonSchemaStr}
                onChange={handleJSONSchemaChange}
                noWrapper
                className="bg h-[80px] overflow-y-auto rounded-[10px] bg-components-input-bg-normal p-1"
                placeholder={
                  <div className="whitespace-pre">{jsonConfigPlaceHolder}</div>
                }
              />
            </Field>
          )}

          <div className="!mt-5 flex h-6 items-center space-x-2">
            <Checkbox checked={tempPayload.required} disabled={tempPayload.hide} onCheck={() => handlePayloadChange('required')(!tempPayload.required)} />
            <span className="system-sm-semibold text-text-secondary">{t('variableConfig.required', { ns: 'appDebug' })}</span>
          </div>

          <div className="!mt-5 flex h-6 items-center space-x-2">
            <Checkbox checked={tempPayload.hide} disabled={tempPayload.required} onCheck={() => handlePayloadChange('hide')(!tempPayload.hide)} />
            <span className="system-sm-semibold text-text-secondary">{t('variableConfig.hide', { ns: 'appDebug' })}</span>
          </div>
        </div>
      </div>
      <ModalFoot
        onConfirm={handleConfirm}
        onCancel={onClose}
      />
    </Modal>
  )
}
export default React.memo(ConfigModal)
