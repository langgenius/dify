'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import ModalFoot from '../modal-foot'
import ConfigSelect from '../config-select'
import ConfigString from '../config-string'
import SelectTypeItem from '../select-type-item'
import Field from './field'
import Toast from '@/app/components/base/toast'
import { getNewVarInWorkflow } from '@/utils/var'
import ConfigContext from '@/context/debug-configuration'
import { type InputVar, InputVarType } from '@/app/components/workflow/types'

import Modal from '@/app/components/base/modal'
import Switch from '@/app/components/base/switch'

export type IConfigModalProps = {
  isCreate?: boolean
  payload?: InputVar
  isShow: boolean
  onClose: () => void
  onConfirm: (newValue: InputVar) => void
}

const inputClassName = 'w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'

const ConfigModal: FC<IConfigModalProps> = ({
  isCreate,
  payload,
  isShow,
  onClose,
  onConfirm,
}) => {
  const { modelConfig } = useContext(ConfigContext)
  const { t } = useTranslation()
  const [tempPayload, setTempPayload] = useState<InputVar>(payload || getNewVarInWorkflow('') as any)
  const { type, label, variable, options, max_length } = tempPayload

  const isStringInput = type === InputVarType.textInput || type === InputVarType.paragraph

  const handlePayloadChange = useCallback((key: string) => {
    return (value: any) => {
      setTempPayload((prev) => {
        return {
          ...prev,
          [key]: value,
        }
      })
    }
  }, [])

  const handleConfirm = () => {
    if (!tempPayload.variable) {
      Toast.notify({ type: 'error', message: t('appDebug.variableConig.errorMsg.varNameRequired') })
      return
    }
    if (!tempPayload.label) {
      Toast.notify({ type: 'error', message: t('appDebug.variableConig.errorMsg.labelNameRequired') })
      return
    }
    if (isStringInput) {
      onConfirm(tempPayload)
    }
    else {
      if (options?.length === 0) {
        Toast.notify({ type: 'error', message: t('appDebug.variableConig.errorMsg.atLeastOneOption') })
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
        Toast.notify({ type: 'error', message: t('appDebug.variableConig.errorMsg.optionRepeat') })
        return
      }
      onConfirm(tempPayload)
    }
  }

  return (
    <Modal
      title={t(`appDebug.variableConig.${isCreate ? 'addModalTitle' : 'editModalTitle'}`)}
      isShow={isShow}
      onClose={onClose}
      wrapperClassName='!z-[100]'
    >
      <div className='mb-8'>
        <div className='space-y-2'>

          <Field title={t('appDebug.variableConig.fieldType')}>
            <div className='flex space-x-2'>
              {/* TODO handlePayloadChange(string)  */}
              <SelectTypeItem type={InputVarType.textInput} selected={type === InputVarType.textInput} onClick={() => handlePayloadChange('type')(InputVarType.textInput)} />
              <SelectTypeItem type={InputVarType.paragraph} selected={type === InputVarType.paragraph} onClick={() => handlePayloadChange('type')(InputVarType.paragraph)} />
              <SelectTypeItem type={InputVarType.select} selected={type === InputVarType.select} onClick={() => handlePayloadChange('type')(InputVarType.select)} />
            </div>
          </Field>

          <Field title={t('appDebug.variableConig.varName')}>
            <input
              type='text'
              className={inputClassName}
              value={variable}
              onChange={e => handlePayloadChange('variable')(e.target.value)}
            />
          </Field>
          <Field title={t('appDebug.variableConig.labelName')}>
            <input
              type='text'
              className={inputClassName}
              value={label}
              onChange={e => handlePayloadChange('label')(e.target.value)}
            />
          </Field>

          {isStringInput && (
            <Field title={t('appDebug.variableConig.maxLength')}>
              <ConfigString modelId={modelConfig.model_id} value={max_length} onChange={handlePayloadChange('max_length')} />
            </Field>

          )}
          {type === InputVarType.select && (
            <Field title={t('appDebug.variableConig.options')}>
              <ConfigSelect options={options || []} onChange={handlePayloadChange('options')} />
            </Field>
          )}

          <Field title={t('appDebug.variableConig.required')}>
            <Switch defaultValue={tempPayload.required} onChange={handlePayloadChange('required')} />
          </Field>
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
