import type { PluginPayload } from '../types'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import type { CredentialPermission } from '@/models/permission'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { PermissionLevel } from '@/models/permission'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { ReadmeEntrance } from '../../readme-panel/entrance'
import {
  useAddPluginCredentialHook,
  useGetPluginCredentialSchemaHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import PluginAuthLoadError from '../load-error'
import { CredentialTypeEnum } from '../types'
import PermissionSelector from './permission-selector'

type ApiKeyModalProps = {
  pluginPayload: PluginPayload
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  editValues?: Record<string, unknown>
  onRemove?: () => void
  disabled?: boolean
  onUpdate?: () => void
  formSchemas?: FormSchema[]
}
const ApiKeyModal = ({
  pluginPayload,
  open = true,
  onOpenChange,
  onClose,
  editValues,
  onRemove,
  disabled,
  onUpdate,
  formSchemas: formSchemasFromProps = [],
}: ApiKeyModalProps) => {
  const { t } = useTranslation(['common', 'plugin'])
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((value: boolean) => {
    doingActionRef.current = value
    setDoingAction(value)
  }, [])
  const schemaQuery = useGetPluginCredentialSchemaHook(pluginPayload, CredentialTypeEnum.API_KEY)
  const { data = [], isLoading } = schemaQuery
  // Without the schema the form has no credential fields, so it cannot be saved.
  // With schemas from props the read is unused, so its failure is left to the toast, as it is
  // while the dialog is closed (it stays mounted).
  const schemaLoad = useOwnedQueryErrors(open && !formSchemasFromProps?.length ? [schemaQuery] : [])
  const [permission, setPermission] = useState<CredentialPermission>(
    editValues?.__visibility__ === PermissionLevel.onlyMe
      ? PermissionLevel.onlyMe
      : PermissionLevel.allTeamMembers,
  )
  const mergedData = useMemo(() => {
    if (formSchemasFromProps?.length) return formSchemasFromProps

    return data
  }, [formSchemasFromProps, data])
  const formSchemas = useMemo(() => {
    return [
      {
        type: FormTypeEnum.textInput,
        name: '__name__',
        label: t(($) => $['auth.authorizationName'], { ns: 'plugin' }),
        required: false,
      },
      ...mergedData,
    ]
  }, [mergedData, t])
  const defaultValues = formSchemas.reduce(
    (acc, schema) => {
      if (schema.default) acc[schema.name] = schema.default
      return acc
    },
    {} as Record<string, unknown>,
  )
  const { mutateAsync: addPluginCredential } = useAddPluginCredentialHook(pluginPayload)
  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)
  const formRef = useRef<FormRefObject>(null)
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current) return
    const { isCheckValidated, values } = formRef.current?.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    }) || { isCheckValidated: false, values: {} }
    if (!isCheckValidated) return

    try {
      const {
        __name__,
        __credential_id__,
        __visibility__,
        __partial_member_list__,
        __created_by__,
        ...restValues
      } = values

      handleSetDoingAction(true)
      // Visibility is settable only at creation. On edit we don't send it.
      if (editValues) {
        await updatePluginCredential({
          credentials: restValues,
          credential_id: __credential_id__,
          name: __name__ || '',
        })
      } else {
        await addPluginCredential({
          credentials: restValues,
          type: CredentialTypeEnum.API_KEY,
          name: __name__ || '',
          visibility: permission,
        })
      }

      onOpenChange?.(false)
      onClose?.()
      onUpdate?.()
    } finally {
      handleSetDoingAction(false)
    }
  }, [
    addPluginCredential,
    onClose,
    onOpenChange,
    onUpdate,
    updatePluginCredential,
    editValues,
    handleSetDoingAction,
    permission,
  ])

  const isDisabled = disabled || isLoading || doingAction
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange?.(nextOpen)
      if (!nextOpen) onClose?.()
    },
    [onClose, onOpenChange],
  )

  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={handleOpenChange}>
      <DialogContent backdropProps={{ forceRender: true }} className="w-160">
        <DialogHeader>
          <DialogTitle>{t(($) => $['auth.useApiAuth'], { ns: 'plugin' })}</DialogTitle>
          <DialogDescription>
            {t(($) => $['auth.useApiAuthDesc'], { ns: 'plugin' })}
          </DialogDescription>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          {pluginPayload.detail && (
            <ReadmeEntrance pluginDetail={pluginPayload.detail} presentation="dialog" />
          )}
          {isLoading && (
            <div className="flex h-40 items-center justify-center">
              <LoadingPlaceholder />
            </div>
          )}
          {schemaLoad && (
            <PluginAuthLoadError
              error={schemaLoad.error}
              isRetrying={schemaLoad.retrying}
              onRetry={schemaLoad.retry}
            />
          )}
          {!isLoading && !!mergedData.length && (
            <AuthForm
              ref={formRef}
              formSchemas={formSchemas}
              defaultValues={editValues || defaultValues}
              disabled={disabled}
            />
          )}
          {!isLoading && !schemaLoad && !editValues && (
            <div className="mt-4 px-1">
              <div className="mb-1 system-sm-semibold text-text-secondary">
                {t(($) => $['auth.whoCanUse'], { ns: 'plugin' })}
              </div>
              <PermissionSelector
                disabled={disabled}
                permission={permission}
                onChange={setPermission}
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {editValues && (
            <>
              <Button variant="primary" onClick={onRemove} disabled={isDisabled}>
                {t(($) => $['operation.remove'], { ns: 'common' })}
              </Button>
              <div className="mx-1 h-4 w-px bg-divider-regular"></div>
            </>
          )}
          <Button onClick={() => handleOpenChange(false)} disabled={isDisabled}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={isDisabled || !!schemaLoad}>
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </DialogFooter>
        <EncryptedBottom />
      </DialogContent>
    </Dialog>
  )
}

export default memo(ApiKeyModal)
