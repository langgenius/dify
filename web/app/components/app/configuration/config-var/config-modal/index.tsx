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
import type { InputVar, MoreInfo, UploadFileSetting } from '@/app/components/workflow/types'
import Modal from '@/app/components/base/modal'
import Switch from '@/app/components/base/switch'
import { ChangeType, InputVarType } from '@/app/components/workflow/types'
import FileUploadSetting from '@/app/components/workflow/nodes/_base/components/file-upload-setting'

const TEXT_MAX_LENGTH = 256

export type IConfigModalProps = {
  isCreate?: boolean
  payload?: InputVar
  isShow: boolean
  varKeys?: string[]
  onClose: () => void
  onConfirm: (newValue: InputVar, moreInfo?: MoreInfo) => void
  supportFile?: boolean
}

const inputClassName = 'w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-100 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'

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
  const [tempPayload, setTempPayload] = useState<InputVar>(payload || getNewVarInWorkflow('') as any)
  const { type, label, variable, options, max_length } = tempPayload

  const isStringInput = type === InputVarType.textInput || type === InputVarType.paragraph
  const handlePayloadChange = useCallback((key: string) => {
    return (value: any) => {
      if (key === 'variable') {
        const { isValid, errorKey, errorMessageKey } = checkKeys([value], true)
        if (!isValid) {
          Toast.notify({
            type: 'error',
            message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: errorKey }),
          })
          return
        }
      }
      setTempPayload((prev) => {
        const newPayload = {
          ...prev,
          [key]: value,
        }

        return newPayload
      })
    }
  }, [t])

  const handleVarKeyBlur = useCallback((e: any) => {
    if (tempPayload.label)
      return

    setTempPayload((prev) => {
      return {
        ...prev,
        label: e.target.value,
      }
    })
  }, [tempPayload])

  const handleConfirm = () => {
    const moreInfo = tempPayload.variable === payload?.variable
      ? undefined
      : {
        type: ChangeType.changeVarName,
        payload: { beforeKey: payload?.variable || '', afterKey: tempPayload.variable },
      }
    if (!tempPayload.variable) {
      Toast.notify({ type: 'error', message: t('appDebug.variableConig.errorMsg.varNameRequired') })
      return
    }

    if (!tempPayload.label) {
      Toast.notify({ type: 'error', message: t('appDebug.variableConig.errorMsg.labelNameRequired') })
      return
    }
    if (isStringInput || type === InputVarType.number) {
      onConfirm(tempPayload, moreInfo)
    }
    else if (type === InputVarType.select) {
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
    else {
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
            <div className='grid grid-cols-3 gap-2'>
              <SelectTypeItem type={InputVarType.textInput} selected={type === InputVarType.textInput} onClick={() => handlePayloadChange('type')(InputVarType.textInput)} />
              <SelectTypeItem type={InputVarType.paragraph} selected={type === InputVarType.paragraph} onClick={() => handlePayloadChange('type')(InputVarType.paragraph)} />
              <SelectTypeItem type={InputVarType.select} selected={type === InputVarType.select} onClick={() => handlePayloadChange('type')(InputVarType.select)} />
              <SelectTypeItem type={InputVarType.number} selected={type === InputVarType.number} onClick={() => handlePayloadChange('type')(InputVarType.number)} />
              {supportFile && <>
                <SelectTypeItem type={InputVarType.singleFile} selected={type === InputVarType.singleFile} onClick={() => handlePayloadChange('type')(InputVarType.singleFile)} />
                <SelectTypeItem type={InputVarType.multiFiles} selected={type === InputVarType.multiFiles} onClick={() => handlePayloadChange('type')(InputVarType.multiFiles)} />
              </>}
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

          {[InputVarType.singleFile, InputVarType.multiFiles].includes(type) && (
            <FileUploadSetting
              payload={tempPayload as UploadFileSetting}
              onChange={(p: UploadFileSetting) => setTempPayload(p as InputVar)}
              isMultiple={type === InputVarType.multiFiles}
            />
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
