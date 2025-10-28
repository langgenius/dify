'use client'
import type { ChangeEvent, FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { produce } from 'immer'
import ModalFoot from '../modal-foot'
import ConfigSelect from '../config-select'
import ConfigString from '../config-string'
import Field from './field'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { checkKeys, getNewVarInWorkflow, replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'
import ConfigContext from '@/context/debug-configuration'
import type { InputVar, MoreInfo, UploadFileSetting } from '@/app/components/workflow/types'
import Modal from '@/app/components/base/modal'
import { ChangeType, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import FileUploadSetting from '@/app/components/workflow/nodes/_base/components/file-upload-setting'
import Checkbox from '@/app/components/base/checkbox'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import type { Item as SelectItem } from './type-select'
import TypeSelector from './type-select'
import { SimpleSelect } from '@/app/components/base/select'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { jsonConfigPlaceHolder, jsonObjectWrap } from './config'
import { useStore as useAppStore } from '@/app/components/app/store'
import Textarea from '@/app/components/base/textarea'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { TransferMethod } from '@/types/app'
import type { FileEntity } from '@/app/components/base/file-uploader/types'

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
  const [tempPayload, setTempPayload] = useState<InputVar>(() => payload || getNewVarInWorkflow('') as any)
  const { type, label, variable, options, max_length } = tempPayload
  const modalRef = useRef<HTMLDivElement>(null)
  const appDetail = useAppStore(state => state.appDetail)
  const isBasicApp = appDetail?.mode !== 'advanced-chat' && appDetail?.mode !== 'workflow'
  const isSupportJSON = false
  const jsonSchemaStr = useMemo(() => {
    const isJsonObject = type === InputVarType.jsonObject
    if (!isJsonObject || !tempPayload.json_schema)
      return ''
    try {
      return JSON.stringify(JSON.parse(tempPayload.json_schema).properties, null, 2)
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
        message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: t('appDebug.variableConfig.varName') }),
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

        return newPayload
      })
    }
  }, [])

  const handleJSONSchemaChange = useCallback((value: string) => {
    try {
      const v = JSON.parse(value)
      const res = {
        ...jsonObjectWrap,
        properties: v,
      }
      handlePayloadChange('json_schema')(JSON.stringify(res, null, 2))
    }
    catch {
      return null
    }
  }, [handlePayloadChange])

  const selectOptions: SelectItem[] = [
    {
      name: t('appDebug.variableConfig.text-input'),
      value: InputVarType.textInput,
    },
    {
      name: t('appDebug.variableConfig.paragraph'),
      value: InputVarType.paragraph,
    },
    {
      name: t('appDebug.variableConfig.select'),
      value: InputVarType.select,
    },
    {
      name: t('appDebug.variableConfig.number'),
      value: InputVarType.number,
    },
    {
      name: t('appDebug.variableConfig.checkbox'),
      value: InputVarType.checkbox,
    },
    ...(supportFile ? [
      {
        name: t('appDebug.variableConfig.single-file'),
        value: InputVarType.singleFile,
      },
      {
        name: t('appDebug.variableConfig.multi-files'),
        value: InputVarType.multiFiles,
      },
    ] : []),
    ...((!isBasicApp && isSupportJSON) ? [{
      name: t('appDebug.variableConfig.json'),
      value: InputVarType.jsonObject,
    }] : []),
  ]

  const handleTypeChange = useCallback((item: SelectItem) => {
    const type = item.value as InputVarType

    const newPayload = produce(tempPayload, (draft) => {
      draft.type = type
      if ([InputVarType.singleFile, InputVarType.multiFiles].includes(type)) {
        (Object.keys(DEFAULT_FILE_UPLOAD_SETTING)).forEach((key) => {
          if (key !== 'max_length')
            (draft as any)[key] = (DEFAULT_FILE_UPLOAD_SETTING as any)[key]
        })
        if (type === InputVarType.multiFiles)
          draft.max_length = DEFAULT_FILE_UPLOAD_SETTING.max_length
      }
      if (type === InputVarType.paragraph)
        draft.max_length = DEFAULT_VALUE_MAX_LEN
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
        message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: errorKey }),
      })
      return
    }
    handlePayloadChange('variable')(e.target.value)
  }, [handlePayloadChange, t])

  const checkboxDefaultSelectValue = useMemo(() => getCheckboxDefaultSelectValue(tempPayload.default), [tempPayload.default])

  const handleConfirm = () => {
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
      Toast.notify({ type: 'error', message: t('appDebug.variableConfig.errorMsg.labelNameRequired') })
      return
    }
    if (isStringInput || type === InputVarType.number) {
      onConfirm(tempPayload, moreInfo)
    }
    else if (type === InputVarType.select) {
      if (options?.length === 0) {
        Toast.notify({ type: 'error', message: t('appDebug.variableConfig.errorMsg.atLeastOneOption') })
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
        Toast.notify({ type: 'error', message: t('appDebug.variableConfig.errorMsg.optionRepeat') })
        return
      }
      onConfirm(tempPayload, moreInfo)
    }
    else if ([InputVarType.singleFile, InputVarType.multiFiles].includes(type)) {
      if (tempPayload.allowed_file_types?.length === 0) {
        const errorMessages = t('workflow.errorMsg.fieldRequired', { field: t('appDebug.variableConfig.file.supportFileTypes') })
        Toast.notify({ type: 'error', message: errorMessages })
        return
      }
      if (tempPayload.allowed_file_types?.includes(SupportUploadFileTypes.custom) && !tempPayload.allowed_file_extensions?.length) {
        const errorMessages = t('workflow.errorMsg.fieldRequired', { field: t('appDebug.variableConfig.file.custom.name') })
        Toast.notify({ type: 'error', message: errorMessages })
        return
      }
      onConfirm(tempPayload, moreInfo)
    }
    else {
      onConfirm(tempPayload, moreInfo)
    }
  }

  return (
    <Modal
      title={t(`appDebug.variableConfig.${isCreate ? 'addModalTitle' : 'editModalTitle'}`)}
      isShow={isShow}
      onClose={onClose}
    >
      <div className='mb-8' ref={modalRef} tabIndex={-1}>
        <div className='space-y-2'>
          <Field title={t('appDebug.variableConfig.fieldType')}>
            <TypeSelector value={type} items={selectOptions} onSelect={handleTypeChange} />
          </Field>

          <Field title={t('appDebug.variableConfig.varName')}>
            <Input
              value={variable}
              onChange={handleVarNameChange}
              onBlur={handleVarKeyBlur}
              placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
            />
          </Field>
          <Field title={t('appDebug.variableConfig.labelName')}>
            <Input
              value={label as string}
              onChange={e => handlePayloadChange('label')(e.target.value)}
              placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
            />
          </Field>

          {isStringInput && (
            <Field title={t('appDebug.variableConfig.maxLength')}>
              <ConfigString maxLength={type === InputVarType.textInput ? TEXT_MAX_LENGTH : Infinity} modelId={modelConfig.model_id} value={max_length} onChange={handlePayloadChange('max_length')} />
            </Field>

          )}

          {/* Default value for text input */}
          {type === InputVarType.textInput && (
            <Field title={t('appDebug.variableConfig.defaultValue')}>
              <Input
                value={tempPayload.default || ''}
                onChange={e => handlePayloadChange('default')(e.target.value || undefined)}
                placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
              />
            </Field>
          )}

          {/* Default value for paragraph */}
          {type === InputVarType.paragraph && (
            <Field title={t('appDebug.variableConfig.defaultValue')}>
              <Textarea
                value={String(tempPayload.default ?? '')}
                onChange={e => handlePayloadChange('default')(e.target.value || undefined)}
                placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
              />
            </Field>
          )}

          {/* Default value for number input */}
          {type === InputVarType.number && (
            <Field title={t('appDebug.variableConfig.defaultValue')}>
              <Input
                type="number"
                value={tempPayload.default || ''}
                onChange={e => handlePayloadChange('default')(e.target.value || undefined)}
                placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
              />
            </Field>
          )}

          {type === InputVarType.checkbox && (
            <Field title={t('appDebug.variableConfig.defaultValue')}>
              <SimpleSelect
                className="w-full"
                optionWrapClassName="max-h-[140px] overflow-y-auto"
                items={[
                  { value: CHECKBOX_DEFAULT_TRUE_VALUE, name: t('appDebug.variableConfig.startChecked') },
                  { value: CHECKBOX_DEFAULT_FALSE_VALUE, name: t('appDebug.variableConfig.noDefaultSelected') },
                ]}
                defaultValue={checkboxDefaultSelectValue}
                onSelect={item => handlePayloadChange('default')(parseCheckboxSelectValue(String(item.value)))}
                placeholder={t('appDebug.variableConfig.selectDefaultValue')}
                allowSearch={false}
              />
            </Field>
          )}

          {type === InputVarType.select && (
            <>
              <Field title={t('appDebug.variableConfig.options')}>
                <ConfigSelect options={options || []} onChange={handlePayloadChange('options')} />
              </Field>
              {options && options.length > 0 && (
                <Field title={t('appDebug.variableConfig.defaultValue')}>
                  <SimpleSelect
                    key={`default-select-${options.join('-')}`}
                    className="w-full"
                    optionWrapClassName="max-h-[140px] overflow-y-auto"
                    items={[
                      { value: '', name: t('appDebug.variableConfig.noDefaultValue') },
                      ...options.filter(opt => opt.trim() !== '').map(option => ({
                        value: option,
                        name: option,
                      })),
                    ]}
                    defaultValue={tempPayload.default || ''}
                    onSelect={item => handlePayloadChange('default')(item.value === '' ? undefined : item.value)}
                    placeholder={t('appDebug.variableConfig.selectDefaultValue')}
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
              <Field title={t('appDebug.variableConfig.defaultValue')}>
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
            <Field title={t('appDebug.variableConfig.jsonSchema')} isOptional>
              <CodeEditor
                language={CodeLanguage.json}
                value={jsonSchemaStr}
                onChange={handleJSONSchemaChange}
                noWrapper
                className='bg h-[80px] overflow-y-auto rounded-[10px] bg-components-input-bg-normal p-1'
                placeholder={
                  <div className='whitespace-pre'>{jsonConfigPlaceHolder}</div>
                }
              />
            </Field>
          )}

          <div className='!mt-5 flex h-6 items-center space-x-2'>
            <Checkbox checked={tempPayload.required} disabled={tempPayload.hide} onCheck={() => handlePayloadChange('required')(!tempPayload.required)} />
            <span className='system-sm-semibold text-text-secondary'>{t('appDebug.variableConfig.required')}</span>
          </div>

          <div className='!mt-5 flex h-6 items-center space-x-2'>
            <Checkbox checked={tempPayload.hide} disabled={tempPayload.required} onCheck={() => handlePayloadChange('hide')(!tempPayload.hide)} />
            <span className='system-sm-semibold text-text-secondary'>{t('appDebug.variableConfig.hide')}</span>
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
