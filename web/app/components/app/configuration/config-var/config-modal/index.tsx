'use client'
import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { ChangeEvent, RefObject } from 'react'
import type { Item as SelectItem } from './type-select'
import type { ConfigModalValidationError } from './utils'
import type { InputVar, InputVarType, MoreInfo } from '@/app/components/workflow/types'
import type { FileUploadConfigResponse } from '@/models/common'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { toast } from '@/app/components/app/configuration/toast'
import { useStore as useAppStore } from '@/app/components/app/store'
import ConfigContext from '@/context/debug-configuration'
import { commonQueryKeys } from '@/service/use-common'
import { AppModeEnum } from '@/types/app'
import {
  checkKeys,
  getNewVarInWorkflow,
  replaceSpaceWithUnderscoreInVarNameInput,
} from '@/utils/var'
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

type ConfigModalProps = {
  isCreate?: boolean
  payload?: InputVar
  open: boolean
  finalFocus?: DialogContentProps['finalFocus']
  onOpenChange: (open: boolean) => void
  onConfirm: (newValue: InputVar, moreInfo?: MoreInfo) => void
  supportFile?: boolean
  showHiddenField?: boolean
}

export const ConfigModal = React.memo(
  ({ open, onOpenChange, finalFocus, ...formProps }: ConfigModalProps) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          initialFocus={scrollAreaRef}
          finalFocus={finalFocus}
          className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden! border-none p-0! text-left align-middle"
        >
          <ConfigModalForm {...formProps} scrollAreaRef={scrollAreaRef} />
        </DialogContent>
      </Dialog>
    )
  },
)

function ConfigModalForm({
  isCreate,
  payload,
  onConfirm,
  showHiddenField,
  supportFile,
  scrollAreaRef,
}: Omit<ConfigModalProps, 'open' | 'onOpenChange' | 'finalFocus'> & {
  scrollAreaRef: RefObject<HTMLDivElement | null>
}) {
  const [initialPayload] = useState(() => payload)
  const { modelConfig } = useContext(ConfigContext)
  const { t } = useTranslation(['appDebug', 'workflow'])
  const { t: tCommon } = useTranslation(['common'])
  const [tempPayload, setTempPayload] = useState<InputVar>(() =>
    normalizeSelectDefaultValue(initialPayload || getNewVarInWorkflow('')),
  )
  const [validationError, setValidationError] = useState<ConfigModalValidationError>()
  const queryClient = useQueryClient()
  const { type, options, max_length } = tempPayload
  const appDetail = useAppStore((state) => state.appDetail)
  const isBasicApp =
    appDetail?.mode !== AppModeEnum.ADVANCED_CHAT && appDetail?.mode !== AppModeEnum.WORKFLOW
  const jsonSchemaStr = useMemo(
    () => getJsonSchemaEditorValue(type, tempPayload.json_schema),
    [tempPayload.json_schema, type],
  )
  useEffect(() => {
    if (validationError)
      scrollAreaRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [scrollAreaRef, validationError])

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
    return (value: any) => {
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
    setTempPayload((prev) => createPayloadForType(prev, item.value as InputVarType))
    setValidationError(undefined)
  }, [])

  const handleVarKeyBlur = useCallback(
    (e: any) => {
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
    (e: ChangeEvent<any>) => {
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
    const fileUploadConfig = queryClient.getQueryData<FileUploadConfigResponse>(
      commonQueryKeys.fileUploadConfig,
    )
    const { errorMessage, errorField, moreInfo, payloadToSave } = validateConfigModalPayload({
      tempPayload,
      payload: initialPayload,
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
    <form
      noValidate
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        handleConfirm()
      }}
    >
      <DialogTitle className="shrink-0 px-6 pt-6 title-2xl-semi-bold text-text-primary">
        {t(($) => $[`variableConfig.${isCreate ? 'addModalTitle' : 'editModalTitle'}`], {
          ns: 'appDebug',
        })}
      </DialogTitle>

      <div
        ref={scrollAreaRef}
        tabIndex={-1}
        data-testid="config-modal-scroll-area"
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-4 pb-8"
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
      </div>
      <div className="shrink-0 px-6 pt-2 pb-6">
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button />}>{tCommon(($) => $['operation.cancel'])}</DialogClose>
          <Button type="submit" variant="primary">
            {tCommon(($) => $['operation.save'])}
          </Button>
        </div>
      </div>
    </form>
  )
}
