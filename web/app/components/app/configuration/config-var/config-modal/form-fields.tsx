'use client'
import type { ChangeEvent, FC } from 'react'
import type { Item as SelectOptionItem } from './type-select'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputVar, UploadFileSetting } from '@/app/components/workflow/types'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
import { Trans } from 'react-i18next'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { Infotip } from '@/app/components/base/infotip'
import Input from '@/app/components/base/input'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import FileUploadSetting from '@/app/components/workflow/nodes/_base/components/file-upload-setting'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'
import { TransferMethod } from '@/types/app'
import ConfigSelect from '../config-select'
import ConfigString from '../config-string'
import { jsonConfigPlaceHolder } from './config'
import Field from './field'
import TypeSelector from './type-select'
import { CHECKBOX_DEFAULT_FALSE_VALUE, CHECKBOX_DEFAULT_TRUE_VALUE, TEXT_MAX_LENGTH } from './utils'

type Translate = (key: string, options?: Record<string, unknown>) => string
const EMPTY_SELECT_VALUE = '__empty__' as const

type ConfigModalFormFieldsProps = {
  checkboxDefaultSelectValue: string
  isStringInput: boolean
  jsonSchemaStr: string
  maxLength?: number
  modelId: string
  onFilePayloadChange: (payload: UploadFileSetting) => void
  onJSONSchemaChange: (value: string) => void
  onPayloadChange: (key: string) => (value: unknown) => void
  onTypeChange: (item: SelectOptionItem) => void
  onVarKeyBlur: (event: ChangeEvent<HTMLInputElement>) => void
  onVarNameChange: (event: ChangeEvent<HTMLInputElement>) => void
  options?: string[]
  selectOptions: SelectOptionItem[]
  showHiddenField?: boolean
  tempPayload: InputVar
  t: Translate
}

const ConfigModalFormFields: FC<ConfigModalFormFieldsProps> = ({
  checkboxDefaultSelectValue,
  isStringInput,
  jsonSchemaStr,
  maxLength,
  modelId,
  onFilePayloadChange,
  onJSONSchemaChange,
  onPayloadChange,
  onTypeChange,
  onVarKeyBlur,
  onVarNameChange,
  options,
  selectOptions,
  showHiddenField = true,
  tempPayload,
  t,
}) => {
  const { type, label, variable } = tempPayload
  const isFileInput = [InputVarType.singleFile, InputVarType.multiFiles].includes(type)
  const docLink = useDocLink()
  const hiddenDescriptionAriaLabel = t('variableConfig.hiddenDescription', { ns: 'appDebug' }).replace(/<[^>]+>/g, '')

  return (
    <div className="space-y-2">
      <Field title={t('variableConfig.fieldType', { ns: 'appDebug' })}>
        <TypeSelector value={type} items={selectOptions} onSelect={onTypeChange} />
      </Field>

      <Field title={t('variableConfig.varName', { ns: 'appDebug' })}>
        <Input
          value={variable}
          onChange={onVarNameChange}
          onBlur={onVarKeyBlur}
          placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
        />
      </Field>
      <Field title={t('variableConfig.labelName', { ns: 'appDebug' })}>
        <Input
          value={label as string}
          onChange={e => onPayloadChange('label')(e.target.value)}
          placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
        />
      </Field>

      {isStringInput && (
        <Field title={t('variableConfig.maxLength', { ns: 'appDebug' })}>
          <ConfigString
            maxLength={type === InputVarType.textInput ? TEXT_MAX_LENGTH : Infinity}
            modelId={modelId}
            value={maxLength}
            onChange={onPayloadChange('max_length')}
          />
        </Field>
      )}

      {type === InputVarType.textInput && (
        <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
          <Input
            value={typeof tempPayload.default === 'string' ? tempPayload.default : ''}
            onChange={e => onPayloadChange('default')(e.target.value || undefined)}
            placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
          />
        </Field>
      )}

      {type === InputVarType.paragraph && (
        <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
          <Textarea
            aria-label={t('variableConfig.defaultValue', { ns: 'appDebug' })}
            value={String(tempPayload.default ?? '')}
            onValueChange={value => onPayloadChange('default')(value || undefined)}
            placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
          />
        </Field>
      )}

      {type === InputVarType.number && (
        <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
          <Input
            type="number"
            value={typeof tempPayload.default === 'number' || typeof tempPayload.default === 'string' ? tempPayload.default : ''}
            onChange={e => onPayloadChange('default')(e.target.value || undefined)}
            placeholder={t('variableConfig.inputPlaceholder', { ns: 'appDebug' })}
          />
        </Field>
      )}

      {type === InputVarType.checkbox && (
        <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
          <Select value={checkboxDefaultSelectValue} onValueChange={value => onPayloadChange('default')(value === CHECKBOX_DEFAULT_TRUE_VALUE)}>
            <SelectTrigger size="large" className="w-full">
              <SelectValue placeholder={t('variableConfig.selectDefaultValue', { ns: 'appDebug' })} />
            </SelectTrigger>
            <SelectContent listClassName="max-h-[140px] overflow-y-auto">
              <SelectItem value={CHECKBOX_DEFAULT_TRUE_VALUE}>
                <SelectItemText>{t('variableConfig.startChecked', { ns: 'appDebug' })}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
              <SelectItem value={CHECKBOX_DEFAULT_FALSE_VALUE}>
                <SelectItemText>{t('variableConfig.noDefaultSelected', { ns: 'appDebug' })}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {type === InputVarType.select && (
        <>
          <Field title={t('variableConfig.options', { ns: 'appDebug' })}>
            <ConfigSelect options={options || []} onChange={onPayloadChange('options')} />
          </Field>
          {options && options.length > 0 && (
            <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
              <Select<string>
                key={`default-select-${options.join('-')}`}
                value={typeof tempPayload.default === 'string' ? tempPayload.default : EMPTY_SELECT_VALUE}
                onValueChange={(value) => {
                  if (value == null)
                    return
                  onPayloadChange('default')(value === EMPTY_SELECT_VALUE ? undefined : value)
                }}
              >
                <SelectTrigger size="large" className="w-full">
                  <SelectValue placeholder={t('variableConfig.selectDefaultValue', { ns: 'appDebug' })} />
                </SelectTrigger>
                <SelectContent listClassName="max-h-[140px] overflow-y-auto">
                  <SelectItem value={EMPTY_SELECT_VALUE}>
                    <SelectItemText>{t('variableConfig.noDefaultValue', { ns: 'appDebug' })}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                  {options.filter(option => option.trim() !== '').map(option => (
                    <SelectItem key={option} value={option}>
                      <SelectItemText>{option}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </>
      )}

      {isFileInput && (
        <>
          <FileUploadSetting
            payload={tempPayload as UploadFileSetting}
            onChange={onFilePayloadChange}
            isMultiple={type === InputVarType.multiFiles}
          />
          <Field title={t('variableConfig.defaultValue', { ns: 'appDebug' })}>
            <FileUploaderInAttachmentWrapper
              value={(type === InputVarType.singleFile ? (tempPayload.default ? [tempPayload.default] : []) : (tempPayload.default || [])) as unknown as FileEntity[]}
              onChange={(files) => {
                if (type === InputVarType.singleFile)
                  onPayloadChange('default')(files?.[0] || undefined)
                else
                  onPayloadChange('default')(files || undefined)
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
            onChange={onJSONSchemaChange}
            noWrapper
            className="h-[80px] overflow-y-auto rounded-[10px] bg-components-input-bg-normal p-1"
            placeholder={<div className="whitespace-pre">{jsonConfigPlaceHolder}</div>}
          />
        </Field>
      )}

      <label className="mt-5! flex h-6 items-center space-x-2">
        <Checkbox
          checked={tempPayload.required}
          disabled={!isFileInput && tempPayload.hide}
          onCheckedChange={checked => onPayloadChange('required')(checked)}
        />
        <span className="system-sm-semibold text-text-secondary">{t('variableConfig.required', { ns: 'appDebug' })}</span>
      </label>

      {showHiddenField && !isFileInput && (
        <div className="mt-5! flex h-6 items-center gap-2">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={tempPayload.hide}
              disabled={tempPayload.required}
              onCheckedChange={checked => onPayloadChange('hide')(checked)}
            />
            <span className="system-sm-semibold text-text-secondary">{t('variableConfig.hidden', { ns: 'appDebug' })}</span>
          </label>
          <div className="flex items-center gap-1">
            <Infotip
              aria-label={hiddenDescriptionAriaLabel}
              popupClassName="max-w-[300px]"
            >
              <Trans
                i18nKey={$ => $["variableConfig.hiddenDescription"]}
                ns="appDebug"
                components={{
                  docLink: (
                    <a
                      href={docLink('/use-dify/nodes/user-input#hide-and-pre-fill-input-fields')}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-accent hover:underline"
                    />
                  ),
                }}
              />
            </Infotip>
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(ConfigModalFormFields)
