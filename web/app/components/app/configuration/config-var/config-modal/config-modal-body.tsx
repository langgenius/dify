'use client'

import type { FC } from 'react'
import type { ConfigModalState } from './use-config-modal-state'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputVar, UploadFileSetting } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/base/ui/select'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import FileUploadSetting from '@/app/components/workflow/nodes/_base/components/file-upload-setting'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import ConfigSelect from '../config-select'
import ConfigString from '../config-string'
import ModalFoot from '../modal-foot'
import { jsonConfigPlaceHolder } from './config'
import Field from './field'
import {
  CHECKBOX_DEFAULT_FALSE_VALUE,
  CHECKBOX_DEFAULT_TRUE_VALUE,
  FILE_INPUT_TYPES,
  parseCheckboxSelectValue,
  TEXT_MAX_LENGTH,
} from './helpers'
import TypeSelector from './type-select'

type Props = {
  onClose: () => void
  state: ConfigModalState
}

type SelectOption = {
  value: string
  name: string
}

type InlineSelectProps = {
  value: string
  items: SelectOption[]
  placeholder: string
  onChange: (value: string) => void
}

const InlineSelect = ({
  value,
  items,
  placeholder,
  onChange,
}: InlineSelectProps) => {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== null)
          onChange(nextValue)
      }}
    >
      <SelectTrigger aria-label={placeholder} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent listClassName="max-h-[140px]">
        {items.map(item => (
          <SelectItem key={item.value} value={item.value}>
            {item.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const EMPTY_DEFAULT_VALUE = '__empty-default__'

const ConfigModalBody: FC<Props> = ({
  state,
  onClose,
}) => {
  const { t } = useTranslation()
  const {
    checkboxDefaultSelectValue,
    handleConfirm,
    handleJSONSchemaChange,
    handlePayloadChange,
    handleTypeChange,
    handleVarKeyBlur,
    handleVarNameChange,
    isStringInput,
    jsonSchemaStr,
    modelId,
    modalRef,
    selectOptions,
    setTempPayload,
    tempPayload,
  } = state

  const { type, label, max_length, options, variable } = tempPayload
  const isFileInput = FILE_INPUT_TYPES.includes(type as typeof FILE_INPUT_TYPES[number])

  return (
    <>
      <div className="mb-8" ref={modalRef} tabIndex={-1}>
        <div className="space-y-2">
          <Field title={t('variableConfig.fieldType', { ns: 'appDebug' })}>
            <TypeSelector value={type} items={selectOptions} onSelect={handleTypeChange} />
          </Field>

          <Field title={t('variableConfig.varName', { ns: 'appDebug' })}>
            <Input
              value={variable}
              onBlur={handleVarKeyBlur}
              onChange={handleVarNameChange}
              placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
            />
          </Field>

          <Field title={t('variableConfig.labelName', { ns: 'appDebug' })}>
            <Input
              value={label as string}
              onChange={event => handlePayloadChange('label')(event.target.value)}
              placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
            />
          </Field>

          {isStringInput && (
            <Field title={t('variableConfig.maxLength', { ns: 'appDebug' })}>
              <ConfigString
                maxLength={type === InputVarType.textInput ? TEXT_MAX_LENGTH : Number.POSITIVE_INFINITY}
                modelId={modelId}
                value={max_length}
                onChange={handlePayloadChange('max_length') as (value: number | undefined) => void}
              />
            </Field>
          )}

          {type === InputVarType.textInput && (
            <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
              <Input
                value={tempPayload.default || ''}
                onChange={event => handlePayloadChange('default')(event.target.value || undefined)}
                placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
              />
            </Field>
          )}

          {type === InputVarType.paragraph && (
            <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
              <Textarea
                value={String(tempPayload.default ?? '')}
                onChange={event => handlePayloadChange('default')(event.target.value || undefined)}
                placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
              />
            </Field>
          )}

          {type === InputVarType.number && (
            <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
              <Input
                type="number"
                value={tempPayload.default || ''}
                onChange={event => handlePayloadChange('default')(event.target.value || undefined)}
                placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
              />
            </Field>
          )}

          {type === InputVarType.checkbox && (
            <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
              <InlineSelect
                value={checkboxDefaultSelectValue}
                items={[
                  {
                    value: CHECKBOX_DEFAULT_TRUE_VALUE,
                    name: t('variableConfig.startChecked', { ns: 'appDebug' }),
                  },
                  {
                    value: CHECKBOX_DEFAULT_FALSE_VALUE,
                    name: t('variableConfig.noDefaultSelected', { ns: 'appDebug' }),
                  },
                ]}
                onChange={value => handlePayloadChange('default')(parseCheckboxSelectValue(value))}
                placeholder={t('variableConfig.selectDefaultValue', { ns: 'appDebug' })}
              />
            </Field>
          )}

          {type === InputVarType.select && (
            <>
              <Field title={t('variableConfig.options', { ns: 'appDebug' })}>
                <ConfigSelect
                  options={options || []}
                  onChange={handlePayloadChange('options') as (value: string[]) => void}
                />
              </Field>

              {options && options.length > 0 && (
                <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
                  <InlineSelect
                    value={String(tempPayload.default || EMPTY_DEFAULT_VALUE)}
                    items={[
                      { value: EMPTY_DEFAULT_VALUE, name: t('variableConfig.noDefaultValue', { ns: 'appDebug' }) },
                      ...options
                        .filter(option => option.trim() !== '')
                        .map(option => ({ value: option, name: option })),
                    ]}
                    onChange={value => handlePayloadChange('default')(value === EMPTY_DEFAULT_VALUE ? undefined : value)}
                    placeholder={t('variableConfig.selectDefaultValue', { ns: 'appDebug' })}
                  />
                </Field>
              )}
            </>
          )}

          {isFileInput && (
            <>
              <FileUploadSetting
                isMultiple={type === InputVarType.multiFiles}
                onChange={payload => setTempPayload(payload as InputVar)}
                payload={tempPayload as UploadFileSetting}
              />
              <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
                <FileUploaderInAttachmentWrapper
                  fileConfig={{
                    allowed_file_extensions: tempPayload.allowed_file_extensions || [],
                    allowed_file_types: tempPayload.allowed_file_types || [SupportUploadFileTypes.document],
                    allowed_file_upload_methods: tempPayload.allowed_file_upload_methods || [TransferMethod.remote_url],
                    number_limits: type === InputVarType.singleFile ? 1 : tempPayload.max_length || 5,
                  }}
                  onChange={(files) => {
                    if (type === InputVarType.singleFile)
                      handlePayloadChange('default')(files?.[0] || undefined)
                    else
                      handlePayloadChange('default')(files || undefined)
                  }}
                  value={(
                    type === InputVarType.singleFile
                      ? (tempPayload.default ? [tempPayload.default] : [])
                      : (tempPayload.default || [])
                  ) as unknown as FileEntity[]}
                />
              </Field>
            </>
          )}

          {type === InputVarType.jsonObject && (
            <Field isOptional title={t('variableConfig.jsonSchema', { ns: 'appDebug' })}>
              <CodeEditor
                className="h-[80px] overflow-y-auto rounded-[10px] bg-components-input-bg-normal p-1"
                language={CodeLanguage.json}
                noWrapper
                onChange={handleJSONSchemaChange}
                placeholder={<div className="whitespace-pre">{jsonConfigPlaceHolder}</div>}
                value={jsonSchemaStr}
              />
            </Field>
          )}

          <div className="!mt-5 flex h-6 items-center space-x-2">
            <Checkbox
              checked={tempPayload.required}
              disabled={tempPayload.hide}
              onCheck={() => handlePayloadChange('required')(!tempPayload.required)}
            />
            <span className="text-text-secondary system-sm-semibold">{t('variableConfig.required', { ns: 'appDebug' })}</span>
          </div>

          <div className="!mt-5 flex h-6 items-center space-x-2">
            <Checkbox
              checked={tempPayload.hide}
              disabled={tempPayload.required}
              onCheck={() => handlePayloadChange('hide')(!tempPayload.hide)}
            />
            <span className="text-text-secondary system-sm-semibold">{t('variableConfig.hide', { ns: 'appDebug' })}</span>
          </div>
        </div>
      </div>

      <ModalFoot
        onCancel={onClose}
        onConfirm={handleConfirm}
      />
    </>
  )
}

export default React.memo(ConfigModalBody)
