'use client'

import type { ChangeEvent, FC } from 'react'
import type { Item as SelectItem } from './type-select'
import type { ConfigModalValidationError } from './utils'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { toast } from '@/app/components/app/configuration/toast'
import ConfigContext from '@/context/debug-configuration'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import {
  checkKeys,
  getNewVarInWorkflow,
  replaceSpaceWithUnderscoreInVarNameInput,
} from '@/utils/var'
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
  showHiddenField?: boolean
}

const ConfigModal: FC<IConfigModalProps> = ({
  isCreate,
  payload,
  isShow,
  onClose,
  onConfirm,
  showHiddenField,
  supportFile,
}) => {
  const { modelConfig } = useContext(ConfigContext)
  const { t } = useTranslation(['appDebug', 'workflow'])
  const [tempPayload, setTempPayload] = useState<InputVar>(() =>
    normalizeSelectDefaultValue(payload || getNewVarInWorkflow('')),
  )
  const [validationError, setValidationError] = useState<ConfigModalValidationError>()
  const queryClient = useQueryClient()
  const { type, options, max_length } = tempPayload
  const modalRef = useRef<HTMLDivElement>(null)
  const { appId } = useParams<{ appId?: string }>()
  const { data: appDetail } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
    }),
  )
  const isBasicApp = appDetail?.mode !== 'advanced-chat' && appDetail?.mode !== 'workflow'
  const jsonSchemaStr = useMemo(
    () => getJsonSchemaEditorValue(type, tempPayload.json_schema),
    [tempPayload.json_schema, type],
  )
  useEffect(() => {
    // To fix the first input element auto focus, then directly close modal will raise error
    if (isShow) modalRef.current?.focus()
  }, [isShow])
  useEffect(() => {
    if (validationError)
      modalRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [validationError])

  const isStringInput = isStringInputType(type)
  const checkVariableName = useCallback(
    (value: string, canBeEmpty?: boolean) => {
      const { isValid, errorMessageKey } = checkKeys([value], canBeEmpty)
      if (!isValid) {
        toast.error(
          t(($) => $[`varKeyError.${errorMessageKey}`], {
            ns: 'appDebug',
            key: t(($) => $['variableConfig.varName'], { ns: 'appDebug' }),
          }),
        )
        return false
      }
      return true
    },
    [t],
  )
  const handlePayloadChange = useCallback((key: string) => {
    return (value: unknown) => {
      setTempPayload((prev) => updatePayloadField(prev, key, value))
      setValidationError((prev) => (prev?.field === key ? undefined : prev))
    }
  }, [])

  const handleJSONSchemaChange = useCallback(
    (value: string) => {
      const isEmpty = value == null || value.trim() === ''
      if (isEmpty) {
        handlePayloadChange('json_schema')(undefined)
        return null
      }
      try {
        const v = JSON.parse(value)
        handlePayloadChange('json_schema')(JSON.stringify(v, null, 2))
      } catch {
        handlePayloadChange('json_schema')(value)
      }
    },
    [handlePayloadChange],
  )

  const selectOptions: SelectItem[] = useMemo(
    () =>
      buildSelectOptions({
        isBasicApp,
        supportFile,
        t,
      }),
    [isBasicApp, supportFile, t],
  )

  const handleTypeChange = useCallback((item: SelectItem) => {
    setTempPayload((prev) => createPayloadForType(prev, item.value))
    setValidationError(undefined)
  }, [])

  const handleVarKeyBlur = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const varName = e.target.value
      if (!checkVariableName(varName, true) || tempPayload.label) return

      setValidationError((prev) => (prev?.field === 'label' ? undefined : prev))
      setTempPayload((prev) => {
        return {
          ...prev,
          label: varName,
        }
      })
    },
    [checkVariableName, tempPayload.label],
  )

  const handleVarNameChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      replaceSpaceWithUnderscoreInVarNameInput(e.target)
      const value = e.target.value
      const { isValid, errorKey, errorMessageKey } = checkKeys([value], true)
      if (!isValid) {
        toast.error(
          t(($) => $[`varKeyError.${errorMessageKey}`], { ns: 'appDebug', key: errorKey }),
        )
        return
      }
      handlePayloadChange('variable')(e.target.value)
    },
    [handlePayloadChange, t],
  )

  const checkboxDefaultSelectValue = useMemo(
    () => getCheckboxDefaultSelectValue(tempPayload.default),
    [tempPayload.default],
  )

  const handleConfirm = () => {
    const fileUploadConfig = queryClient.getQueryData(consoleQuery.files.upload.get.queryKey())
    const { errorMessage, errorField, moreInfo, payloadToSave } = validateConfigModalPayload({
      tempPayload,
      payload,
      maxFileUploadLimit: Number(fileUploadConfig?.workflow_file_upload_limit) || undefined,
      t,
    })

    if (errorMessage && errorField) {
      setValidationError({ field: errorField, message: errorMessage })
      toast.error(errorMessage)
      return
    }

    if (payloadToSave) {
      setValidationError(undefined)
      onConfirm(payloadToSave, moreInfo)
    }
  }

  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)]">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            handleConfirm()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(($) => $[`variableConfig.${isCreate ? 'addModalTitle' : 'editModalTitle'}`], {
                ns: 'appDebug',
              })}
            </DialogTitle>
          </DialogHeader>

          <DialogBody
            ref={modalRef}
            tabIndex={-1}
            data-testid="config-modal-scroll-area"
            className="min-w-0 overflow-x-hidden"
          >
            <ConfigModalFormFields
              checkboxDefaultSelectValue={checkboxDefaultSelectValue}
              isStringInput={isStringInput}
              jsonSchemaStr={jsonSchemaStr}
              maxLength={max_length}
              modelId={modelConfig.model_id}
              onFilePayloadChange={(nextPayload) => {
                if (
                  validationError &&
                  (validationError.field === 'allowed_file_types' ||
                    validationError.field === 'allowed_file_extensions') &&
                  (nextPayload[validationError.field] !== tempPayload[validationError.field] ||
                    nextPayload.allowed_file_types !== tempPayload.allowed_file_types)
                )
                  setValidationError(undefined)
                setTempPayload(nextPayload as InputVar)
              }}
              onJSONSchemaChange={handleJSONSchemaChange}
              onPayloadChange={handlePayloadChange}
              onTypeChange={handleTypeChange}
              onVarKeyBlur={handleVarKeyBlur}
              onVarNameChange={handleVarNameChange}
              options={options}
              selectOptions={selectOptions}
              showHiddenField={showHiddenField}
              tempPayload={tempPayload}
              validationError={validationError}
              t={t}
            />
          </DialogBody>
          <DialogFooter>
            <ModalFoot confirmType="submit" onCancel={onClose} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(ConfigModal)
