'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import ModalFoot from '../modal-foot'
import ConfigSelect from '../config-select'
import ConfigString from '../config-string'
import SelectTypeItem from '../select-type-item'
import Field from './field'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { checkKeys, getNewVarInWorkflow } from '@/utils/var'
import ConfigContext from '@/context/debug-configuration'
import type { InputVar, MoreInfo, UploadFileSetting } from '@/app/components/workflow/types'
import Modal from '@/app/components/base/modal'
import { ChangeType, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import FileUploadSetting from '@/app/components/workflow/nodes/_base/components/file-upload-setting'
import Checkbox from '@/app/components/base/checkbox'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import { useStore as useAppStore } from '@/app/components/app/store'

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
  const modalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // To fix the first input element auto focus, then directly close modal will raise error
    if (isShow)
      modalRef.current?.focus()
  }, [isShow])

  const appDetail = useAppStore(state => state.appDetail)
  const isChatflow = appDetail?.mode === 'advanced-chat'

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

  const handleTypeChange = useCallback((type: InputVarType) => {
    return () => {
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
    }
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
            <div className='grid grid-cols-3 gap-2'>
              <SelectTypeItem type={InputVarType.textInput} selected={type === InputVarType.textInput} onClick={handleTypeChange(InputVarType.textInput)} />
              <SelectTypeItem type={InputVarType.paragraph} selected={type === InputVarType.paragraph} onClick={handleTypeChange(InputVarType.paragraph)} />
              <SelectTypeItem type={InputVarType.select} selected={type === InputVarType.select} onClick={handleTypeChange(InputVarType.select)} />
              <SelectTypeItem type={InputVarType.number} selected={type === InputVarType.number} onClick={handleTypeChange(InputVarType.number)} />
              {supportFile && <>
                <SelectTypeItem type={InputVarType.singleFile} selected={type === InputVarType.singleFile} onClick={handleTypeChange(InputVarType.singleFile)} />
                <SelectTypeItem type={InputVarType.multiFiles} selected={type === InputVarType.multiFiles} onClick={handleTypeChange(InputVarType.multiFiles)} />
              </>}
            </div>
          </Field>

          <Field title={t('appDebug.variableConfig.varName')}>
            <Input
              value={variable}
              onChange={e => handlePayloadChange('variable')(e.target.value)}
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
          {type === InputVarType.select && (
            <Field title={t('appDebug.variableConfig.options')}>
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

          { isChatflow && (type === InputVarType.select || type === InputVarType.number) && (
            <div className='!mt-5 flex items-center h-6 space-x-2'>
              <Checkbox checked={tempPayload.is_chat_option} onCheck={() => handlePayloadChange('is_chat_option')(!tempPayload.is_chat_option)} />
              <span className='text-text-secondary system-sm-semibold'>{t('appDebug.variableConfig.isChatOption')}</span>
              {type === InputVarType.number && (
                <Tooltip
                  popupContent={<div>{t('appDebug.variableConfig.isChatOptionNumberHint')}</div>}
                  triggerClassName='w-4 h-4'
                  asChild={false}
                />
              )}
            </div>
          )}

          <div className='!mt-5 flex items-center h-6 space-x-2'>
            <Checkbox checked={tempPayload.required} onCheck={() => handlePayloadChange('required')(!tempPayload.required)} />
            <span className='text-text-secondary system-sm-semibold'>{t('appDebug.variableConfig.required')}</span>
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
