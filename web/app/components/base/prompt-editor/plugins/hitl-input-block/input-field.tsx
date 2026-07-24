import type { FormInputItem, FormInputItemDefault } from '@/app/components/workflow/nodes/human-input/types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { InputVarType } from '@/app/components/workflow/types'
import { getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import Button from '../../../button'
import PrePopulate from './pre-populate'

const i18nPrefix = 'nodes.humanInput.insertInputField'

type InputFieldProps = {
  nodeId: string
  isEdit: boolean
  payload?: FormInputItem
  onChange: (newPayload: FormInputItem) => void
  onCancel: () => void
}
const defaultPayload: FormInputItem = {
  type: InputVarType.paragraph,
  output_variable_name: '',
  default: { type: 'constant', selector: [], value: '' },
}
const InputField: React.FC<InputFieldProps> = ({
  nodeId,
  isEdit,
  payload,
  onChange,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [tempPayload, setTempPayload] = useState(payload || defaultPayload)
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
  const defaultValueConfig = tempPayload.default
  const handleDefaultValueChange = useCallback((key: keyof FormInputItemDefault) => {
    return (value: ValueSelector | string) => {
      const nextValue = produce(tempPayload, (draft) => {
        if (!draft.default)
          draft.default = { type: 'constant', selector: [], value: '' }
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
  }, [tempPayload])

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
          {t(`${i18nPrefix}.saveResponseAs`, { ns: 'workflow' })}
          <span className="system-xs-regular relative text-text-destructive-secondary">*</span>
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
          <div className="system-xs-regular mt-1 px-1 text-text-destructive-secondary">
            {t(`${i18nPrefix}.variableNameInvalid`, { ns: 'workflow' })}
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="system-xs-medium mb-1.5 text-text-secondary">
          {t(`${i18nPrefix}.prePopulateField`, { ns: 'workflow' })}
        </div>
        <PrePopulate
          isVariable={defaultValueConfig?.type === 'variable'}
          onIsVariableChange={(isVariable) => {
            handleDefaultValueChange('type')(isVariable ? 'variable' : 'constant')
          }}
          nodeId={nodeId}
          valueSelector={defaultValueConfig?.selector}
          onValueSelectorChange={handleDefaultValueChange('selector')}
          value={defaultValueConfig?.value}
          onValueChange={handleDefaultValueChange('value')}
        />
      </div>
      <div className="mt-4 flex justify-end space-x-2">
        <Button onClick={onCancel}>{t('operation.cancel', { ns: 'common' })}</Button>
        {isEdit
          ? (
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={!nameValid}
              >
                {t('operation.save', { ns: 'common' })}
              </Button>
            )
          : (
              <Button
                className="flex"
                variant="primary"
                disabled={!nameValid}
                onClick={handleSave}
              >
                <span className="mr-1">{t(`${i18nPrefix}.insert`, { ns: 'workflow' })}</span>
                <span className="system-kbd mr-0.5 flex h-4 items-center rounded-[4px] bg-components-kbd-bg-white px-1">{getKeyboardKeyNameBySystem('ctrl')}</span>
                <span className=" system-kbd flex h-4 items-center rounded-[4px] bg-components-kbd-bg-white px-1">↩︎</span>
              </Button>
            )}

      </div>
    </div>
  )
}

export default InputField
