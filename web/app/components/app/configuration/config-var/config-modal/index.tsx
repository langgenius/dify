'use client'
import type { ChangeEvent, FC } from 'react'
import type { Item as SelectItem } from './type-select'
import type { InputVar, InputVarType, MoreInfo } from '@/app/components/workflow/types'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useStore as useAppStore } from '@/app/components/app/store'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum } from '@/types/app'
import { checkKeys, getNewVarInWorkflow, replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'
import ModalFoot from '../modal-foot'
import ConfigModalFormFields from './form-fields'
import {
  buildSelectOptions,
  createPayloadForType,
  getCheckboxDefaultSelectValue,
  getJsonSchemaEditorValue,
  isStringInputType,
  normalizeSelectDefaultValue,
  updatePayloadField,
  validateConfigModalPayload,
} from './utils'

type IConfigModalProps = {
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
  const { type, options, max_length } = tempPayload
  const modalRef = useRef<HTMLDivElement>(null)
  const appDetail = useAppStore(state => state.appDetail)
  const isBasicApp = appDetail?.mode !== AppModeEnum.ADVANCED_CHAT && appDetail?.mode !== AppModeEnum.WORKFLOW
  const jsonSchemaStr = useMemo(() => getJsonSchemaEditorValue(type, tempPayload.json_schema), [tempPayload.json_schema, type])
  useEffect(() => {
    // To fix the first input element auto focus, then directly close modal will raise error
    if (isShow)
      modalRef.current?.focus()
  }, [isShow])

  const isStringInput = isStringInputType(type)
  const checkVariableName = useCallback((value: string, canBeEmpty?: boolean) => {
    const { isValid, errorMessageKey } = checkKeys([value], canBeEmpty)
    if (!isValid) {
      toast.error(t(`varKeyError.${errorMessageKey}`, { ns: 'appDebug', key: t('variableConfig.varName', { ns: 'appDebug' }) }))
      return false
    }
    return true
  }, [t])
  const handlePayloadChange = useCallback((key: string) => {
    return (value: any) => {
      setTempPayload(prev => updatePayloadField(prev, key, value))
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

  const selectOptions: SelectItem[] = useMemo(() => buildSelectOptions({
    isBasicApp,
    supportFile,
    t,
  }), [isBasicApp, supportFile, t])

  const handleTypeChange = useCallback((item: SelectItem) => {
    setTempPayload(prev => createPayloadForType(prev, item.value as InputVarType))
  }, [])

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
      toast.error(t(`varKeyError.${errorMessageKey}`, { ns: 'appDebug', key: errorKey }))
      return
    }
    handlePayloadChange('variable')(e.target.value)
  }, [handlePayloadChange, t])

  const checkboxDefaultSelectValue = useMemo(() => getCheckboxDefaultSelectValue(tempPayload.default), [tempPayload.default])

  const handleConfirm = () => {
    const { errorMessage, moreInfo, payloadToSave } = validateConfigModalPayload({
      tempPayload,
      payload,
      checkVariableName,
      t,
    })

    if (errorMessage) {
      toast.error(errorMessage)
      return
    }

    if (payloadToSave)
      onConfirm(payloadToSave, moreInfo)
  }

  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open)
          onClose()
      }}
    >
      <DialogContent className="overflow-hidden! border-none text-left align-middle">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(`variableConfig.${isCreate ? 'addModalTitle' : 'editModalTitle'}`, { ns: 'appDebug' })}
        </DialogTitle>

        <div className="mb-8" ref={modalRef} tabIndex={-1}>
          <ConfigModalFormFields
            checkboxDefaultSelectValue={checkboxDefaultSelectValue}
            isStringInput={isStringInput}
            jsonSchemaStr={jsonSchemaStr}
            maxLength={max_length}
            modelId={modelConfig.model_id}
            onFilePayloadChange={payload => setTempPayload(payload as InputVar)}
            onJSONSchemaChange={handleJSONSchemaChange}
            onPayloadChange={handlePayloadChange}
            onTypeChange={handleTypeChange}
            onVarKeyBlur={handleVarKeyBlur}
            onVarNameChange={handleVarNameChange}
            options={options}
            selectOptions={selectOptions}
            tempPayload={tempPayload}
            t={t}
          />
        </div>
        <ModalFoot
          onConfirm={handleConfirm}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(ConfigModal)
