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
import { checkKeys, getNewVarInWorkflow } from '@/utils/var'
import ConfigContext from '@/context/debug-configuration'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import Modal from '@/app/components/base/modal'
import Switch from '@/app/components/base/switch'
import { ChangeType, InputVarType } from '@/app/components/workflow/types'

const TEXT_MAX_LENGTH = 256

export type IConfigModalProps = {
  isCreate?: boolean
  payload?: InputVar
  isShow: boolean
  varKeys?: string[]
  onClose: () => void
  onConfirm: (newValue: InputVar, moreInfo?: MoreInfo) => void
}

const inputClassName = 'w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-100 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'

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
  const checkVariableName = useCallback((value: string) => {
    const { isValid, errorMessageKey } = checkKeys([value], false)
    if (!isValid) {
      Toast.notify({
        type: 'error',
        message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: t('appDebug.variableConig.varName') }),
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

  const handleVarKeyBlur = useCallback((e: any) => {
    const varName = e.target.value
    if (!checkVariableName(varName) || tempPayload.label)
      return

    setTempPayload((prev) => {
      return {
        ...prev,
        label: varName,
      }
    })
  }, [checkVariableName, tempPayload.label])

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

    // TODO: check if key already exists. should the consider the edit case
    // if (varKeys.map(key => key?.trim()).includes(tempPayload.variable.trim())) {
    //   Toast.notify({
    //     type: 'error',
    //     message: t('appDebug.varKeyError.keyAlreadyExists', { key: tempPayload.variable }),
    //   })
    //   return
    // }

    if (!tempPayload.label) {
      Toast.notify({ type: 'error', message: t('appDebug.variableConig.errorMsg.labelNameRequired') })
      return
    }
    if (isStringInput || type === InputVarType.number) {
      onConfirm(tempPayload, moreInfo)
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
      onConfirm(tempPayload, moreInfo)
    }
  }

  return (
    <Modal
      title={t(`appDebug.variableConig.${isCreate ? 'addModalTitle' : 'editModalTitle'}`)}
      isShow={isShow}
      onClose={onClose}
    >
      <div className='mb-8'>
        <div className='space-y-2'>

          <Field title={t('appDebug.variableConig.fieldType')}>
            <div className='flex space-x-2'>
              <SelectTypeItem type={InputVarType.textInput} selected={type === InputVarType.textInput} onClick={() => handlePayloadChange('type')(InputVarType.textInput)} />
              <SelectTypeItem type={InputVarType.paragraph} selected={type === InputVarType.paragraph} onClick={() => handlePayloadChange('type')(InputVarType.paragraph)} />
              <SelectTypeItem type={InputVarType.select} selected={type === InputVarType.select} onClick={() => handlePayloadChange('type')(InputVarType.select)} />
              <SelectTypeItem type={InputVarType.number} selected={type === InputVarType.number} onClick={() => handlePayloadChange('type')(InputVarType.number)} />
            </div>
          </Field>

          <Field title={t('appDebug.variableConig.varName')}>
            <input
              type='text'
              className={inputClassName}
              value={variable}
              onChange={e => handlePayloadChange('variable')(e.target.value)}
              onBlur={handleVarKeyBlur}
              placeholder={t('appDebug.variableConig.inputPlaceholder')!}
            />
          </Field>
          <Field title={t('appDebug.variableConig.labelName')}>
            <input
              type='text'
              className={inputClassName}
              value={label as string}
              onChange={e => handlePayloadChange('label')(e.target.value)}
              placeholder={t('appDebug.variableConig.inputPlaceholder')!}
            />
          </Field>

          {isStringInput && (
            <Field title={t('appDebug.variableConig.maxLength')}>
              <ConfigString maxLength={type === InputVarType.textInput ? TEXT_MAX_LENGTH : Infinity} modelId={modelConfig.model_id} value={max_length} onChange={handlePayloadChange('max_length')} />
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
