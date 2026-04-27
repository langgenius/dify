import type { Item as TypeSelectItem } from '@/app/components/app/configuration/config-var/config-modal/type-select'
import type { FormInputItem, FormInputItemDefault, ParagraphFormInput } from '@/app/components/workflow/nodes/human-input/types'
import type { UploadFileSetting, ValueSelector } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import TypeSelector from '@/app/components/app/configuration/config-var/config-modal/type-select'
import ConfigSelect from '@/app/components/app/configuration/config-var/config-select'
import Input from '@/app/components/base/input'
import FileUploadSetting from '@/app/components/workflow/nodes/_base/components/file-upload-setting'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import {
  createDefaultFormInputByType,
  createDefaultParagraphFormInput,
  isFileFormInput,
  isFileListFormInput,
  isParagraphFormInput,
  isSelectFormInput,
} from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import { getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import PrePopulate from './pre-populate'
import TypeSwitch from './type-switch'

const i18nPrefix = 'nodes.humanInput.insertInputField'

type InputFieldProps = {
  nodeId: string
  isEdit: boolean
  payload?: FormInputItem
  onChange: (newPayload: FormInputItem) => void
  onCancel: () => void
}
const InputField: React.FC<InputFieldProps> = ({
  nodeId,
  isEdit,
  payload,
  onChange,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [tempPayload, setTempPayload] = useState<FormInputItem>(() => payload || createDefaultParagraphFormInput())
  const fieldTypeItems = useMemo<TypeSelectItem[]>(() => {
    return [
      {
        name: t('variableConfig.paragraph', { ns: 'appDebug' }),
        value: InputVarType.paragraph,
      },
      {
        name: t('variableConfig.select', { ns: 'appDebug' }),
        value: InputVarType.select,
      },
      {
        name: t('variableConfig.single-file', { ns: 'appDebug' }),
        value: InputVarType.singleFile,
      },
      {
        name: t('variableConfig.multi-files', { ns: 'appDebug' }),
        value: InputVarType.multiFiles,
      },
    ]
  }, [t])
  const paragraphPayload = useMemo<ParagraphFormInput>(() => {
    if (isParagraphFormInput(tempPayload)) {
      return {
        ...tempPayload,
        default: tempPayload.default || createDefaultParagraphFormInput().default,
      }
    }

    return createDefaultParagraphFormInput(tempPayload.output_variable_name)
  }, [tempPayload])
  const nameValid = useMemo(() => {
    const name = tempPayload.output_variable_name.trim()
    if (!name)
      return false
    if (name.includes(' '))
      return false
    return /^[a-z_]\w{0,29}$/.test(name)
  }, [tempPayload.output_variable_name])
  const handleSave = useCallback(() => {
    if (!nameValid)
      return
    onChange(tempPayload)
  }, [nameValid, onChange, tempPayload])
  const handleTypeChange = useCallback((item: TypeSelectItem) => {
    setTempPayload(prev => createDefaultFormInputByType(item.value as FormInputItem['type'], prev.output_variable_name))
  }, [])
  const handleDefaultValueChange = useCallback((key: keyof FormInputItemDefault) => {
    return (value: ValueSelector | string) => {
      const nextValue = produce(paragraphPayload, (draft) => {
        if (key === 'selector') {
          draft.default.type = 'variable'
          draft.default.selector = value as ValueSelector
        }
        else if (key === 'value') {
          draft.default.type = 'constant'
          draft.default.value = value as string
        }
        else if (key === 'type') {
          draft.default.type = value as 'constant' | 'variable'
        }
      })
      setTempPayload(nextValue)
    }
  }, [paragraphPayload])
  const handleSelectOptionsChange = useCallback((options: string[]) => {
    setTempPayload((prev) => {
      if (!isSelectFormInput(prev))
        return prev

      return {
        ...prev,
        option_source: {
          ...prev.option_source,
          type: 'constant',
          value: options,
        },
      }
    })
  }, [])
  const handleSelectOptionSourceTypeChange = useCallback((isVariable: boolean) => {
    setTempPayload((prev) => {
      if (!isSelectFormInput(prev))
        return prev

      return {
        ...prev,
        option_source: {
          ...prev.option_source,
          type: isVariable ? 'variable' : 'constant',
        },
      }
    })
  }, [])
  const handleSelectOptionSourceSelectorChange = useCallback((selector: ValueSelector | string) => {
    setTempPayload((prev) => {
      if (!isSelectFormInput(prev))
        return prev

      return {
        ...prev,
        option_source: {
          ...prev.option_source,
          type: 'variable',
          selector: selector as ValueSelector,
        },
      }
    })
  }, [])
  const handleFilePayloadChange = useCallback((payload: UploadFileSetting) => {
    setTempPayload((prev) => {
      if (!isFileFormInput(prev))
        return prev

      return {
        ...prev,
        allowed_file_extensions: payload.allowed_file_extensions || [],
        allowed_file_types: payload.allowed_file_types,
        allowed_file_upload_methods: payload.allowed_file_upload_methods,
      }
    })
  }, [])
  const handleFileListPayloadChange = useCallback((payload: UploadFileSetting) => {
    setTempPayload((prev) => {
      if (!isFileListFormInput(prev))
        return prev

      return {
        ...prev,
        allowed_file_extensions: payload.allowed_file_extensions || [],
        allowed_file_types: payload.allowed_file_types,
        allowed_file_upload_methods: payload.allowed_file_upload_methods,
        number_limits: payload.max_length,
      }
    })
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleSave])

  return (
    <div className="w-[372px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg backdrop-blur-[5px]">
      <div className="system-md-semibold text-text-primary">{t(`${i18nPrefix}.title`, { ns: 'workflow' })}</div>
      <div className="mt-3">
        <div className="system-xs-medium text-text-secondary">
          {t(`${i18nPrefix}.fieldType`, { ns: 'workflow' })}
        </div>
        <div className="mt-1.5">
          <TypeSelector
            value={tempPayload.type}
            items={fieldTypeItems}
            popupClassName="z-[1000000]"
            onSelect={handleTypeChange}
          />
        </div>
      </div>
      <div className="mt-3">
        <div className="system-xs-medium text-text-secondary">
          {t(`${i18nPrefix}.saveResponseAs`, { ns: 'workflow' })}
          <span className="relative system-xs-regular text-text-destructive-secondary">*</span>
        </div>
        <Input
          className="mt-1.5"
          placeholder={t(`${i18nPrefix}.saveResponseAsPlaceholder`, { ns: 'workflow' })}
          value={tempPayload.output_variable_name}
          onChange={(e) => {
            setTempPayload(prev => ({ ...prev, output_variable_name: e.target.value }))
          }}
          autoFocus
        />
        {tempPayload.output_variable_name && !nameValid && (
          <div className="mt-1 px-1 system-xs-regular text-text-destructive-secondary">
            {t(`${i18nPrefix}.variableNameInvalid`, { ns: 'workflow' })}
          </div>
        )}
      </div>
      {isParagraphFormInput(tempPayload) && (
        <div className="mt-4">
          <div className="mb-1.5 system-xs-medium text-text-secondary">
            {t(`${i18nPrefix}.prePopulateField`, { ns: 'workflow' })}
          </div>
          <PrePopulate
            isVariable={paragraphPayload.default.type === 'variable'}
            onIsVariableChange={(isVariable) => {
              handleDefaultValueChange('type')(isVariable ? 'variable' : 'constant')
            }}
            nodeId={nodeId}
            valueSelector={paragraphPayload.default.selector}
            onValueSelectorChange={handleDefaultValueChange('selector')}
            value={paragraphPayload.default.value}
            onValueChange={handleDefaultValueChange('value')}
          />
        </div>
      )}
      {isSelectFormInput(tempPayload) && (
        <div className="mt-4">
          <div className="mb-1.5 system-xs-medium text-text-secondary">
            {t(`${i18nPrefix}.options`, { ns: 'workflow' })}
          </div>
          {tempPayload.option_source.type === 'variable'
            ? (
                <div className="relative min-h-[80px] rounded-lg border border-transparent bg-components-input-bg-normal px-3 pt-2 pb-8">
                  <VarReferencePicker
                    nodeId={nodeId}
                    value={tempPayload.option_source.selector}
                    onChange={handleSelectOptionSourceSelectorChange}
                    readonly={false}
                    isJustShowValue
                    zIndex={1000000}
                    filterVar={varPayload => varPayload.type === VarType.arrayString}
                  />
                  <TypeSwitch
                    className="absolute bottom-1 left-1.5"
                    isVariable
                    onIsVariableChange={handleSelectOptionSourceTypeChange}
                  />
                </div>
              )
            : (
                <div className={cn('rounded-lg border border-transparent bg-components-input-bg-normal p-2')}>
                  <ConfigSelect
                    options={tempPayload.option_source.value}
                    onChange={handleSelectOptionsChange}
                  />
                  <TypeSwitch
                    className="mt-2"
                    isVariable={false}
                    onIsVariableChange={handleSelectOptionSourceTypeChange}
                  />
                </div>
              )}
        </div>
      )}
      {isFileFormInput(tempPayload) && (
        <div className="mt-4">
          <FileUploadSetting
            payload={{
              ...tempPayload,
              max_length: 1,
            }}
            isMultiple={false}
            onChange={handleFilePayloadChange}
          />
        </div>
      )}
      {isFileListFormInput(tempPayload) && (
        <div className="mt-4">
          <FileUploadSetting
            payload={{
              ...tempPayload,
              max_length: tempPayload.number_limits || 5,
            }}
            isMultiple
            onChange={handleFileListPayloadChange}
          />
        </div>
      )}
      <div className="mt-4 flex justify-end space-x-2">
        <Button data-testid="hitl-input-cancel-btn" onClick={onCancel}>{t('operation.cancel', { ns: 'common' })}</Button>
        {isEdit
          ? (
              <Button
                data-testid="hitl-input-save-btn"
                variant="primary"
                onClick={handleSave}
                disabled={!nameValid}
              >
                {t('operation.save', { ns: 'common' })}
              </Button>
            )
          : (
              <Button
                data-testid="hitl-input-insert-btn"
                className="flex"
                variant="primary"
                disabled={!nameValid}
                onClick={handleSave}
              >
                <span className="mr-1">{t(`${i18nPrefix}.insert`, { ns: 'workflow' })}</span>
                <span className="mr-0.5 flex h-4 items-center rounded-sm bg-components-kbd-bg-white px-1 system-kbd">{getKeyboardKeyNameBySystem('ctrl')}</span>
                <span className="flex h-4 items-center rounded-sm bg-components-kbd-bg-white px-1 system-kbd">↩︎</span>
              </Button>
            )}

      </div>
    </div>
  )
}

export default InputField
