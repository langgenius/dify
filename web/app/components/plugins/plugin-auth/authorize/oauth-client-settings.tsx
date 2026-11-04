import type { PluginPayload } from '../types'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useForm, useSelector } from '@tanstack/react-form'
import { memo, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { toast } from '@/app/notifications'
import { ReadmeEntrance } from '../../readme-panel/entrance'
import {
  useDeletePluginOAuthCustomClientHook,
  useInvalidPluginOAuthClientSchemaHook,
  useSetPluginOAuthCustomClientHook,
} from '../hooks/use-credential'

type OAuthClientSettingsProps = {
  pluginPayload: PluginPayload
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  editValues?: Record<string, unknown>
  disabled?: boolean
  schemas: FormSchema[]
  onRequestAuthorization?: () => Promise<void> | void
  hasOriginalClientParams?: boolean
  onUpdate?: () => void
}
const OAuthClientSettings = ({
  pluginPayload,
  open = true,
  onOpenChange,
  onClose,
  editValues,
  disabled,
  schemas,
  onRequestAuthorization,
  hasOriginalClientParams,
  onUpdate,
}: OAuthClientSettingsProps) => {
  const { t } = useTranslation(['common', 'plugin'])
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((value: boolean) => {
    doingActionRef.current = value
    setDoingAction(value)
  }, [])
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange?.(nextOpen)
      if (!nextOpen) onClose?.()
    },
    [onClose, onOpenChange],
  )
  const defaultValues = schemas.reduce(
    (acc, schema) => {
      if (schema.default) acc[schema.name] = schema.default
      return acc
    },
    {} as Record<string, unknown>,
  )
  const { mutateAsync: setPluginOAuthCustomClient } =
    useSetPluginOAuthCustomClientHook(pluginPayload)
  const invalidPluginOAuthClientSchema = useInvalidPluginOAuthClientSchemaHook(pluginPayload)
  const formRef = useRef<FormRefObject>(null)
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current) return false

    try {
      const { isCheckValidated, values } = formRef.current?.getFormValues({
        needCheckValidatedValues: true,
        needTransformWhenSecretFieldIsPristine: true,
      }) || { isCheckValidated: false, values: {} }
      if (!isCheckValidated) throw new Error('error')
      const { __oauth_client__, ...restValues } = values

      handleSetDoingAction(true)
      await setPluginOAuthCustomClient({
        client_params: restValues,
        enable_oauth_custom_client: __oauth_client__ === 'custom',
      })
      toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))

      onOpenChange?.(false)
      onClose?.()
      onUpdate?.()
      invalidPluginOAuthClientSchema()
      return true
    } finally {
      handleSetDoingAction(false)
    }
  }, [
    onClose,
    onOpenChange,
    onUpdate,
    invalidPluginOAuthClientSchema,
    setPluginOAuthCustomClient,
    t,
    handleSetDoingAction,
  ])

  const handleConfirmAndAuthorize = useCallback(async () => {
    try {
      const isSaved = await handleConfirm()
      if (isSaved) await onRequestAuthorization?.()
    } catch {
      // The request layer reports the save error. Keep settings open and stop
      // before opening the permission dialog.
    }
  }, [handleConfirm, onRequestAuthorization])
  const { mutateAsync: deletePluginOAuthCustomClient } =
    useDeletePluginOAuthCustomClientHook(pluginPayload)
  const handleRemove = useCallback(async () => {
    if (doingActionRef.current) return

    try {
      handleSetDoingAction(true)
      await deletePluginOAuthCustomClient()
      toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
      onOpenChange?.(false)
      onClose?.()
      onUpdate?.()
      invalidPluginOAuthClientSchema()
    } finally {
      handleSetDoingAction(false)
    }
  }, [
    onUpdate,
    invalidPluginOAuthClientSchema,
    deletePluginOAuthCustomClient,
    t,
    handleSetDoingAction,
    onClose,
    onOpenChange,
  ])
  const form = useForm({
    defaultValues: editValues || defaultValues,
  })
  const __oauth_client__ = useSelector(form.store, (s) => s.values.__oauth_client__)
  const isDisabled = disabled || doingAction

  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={handleOpenChange}>
      <DialogContent backdropProps={{ forceRender: true }}>
        <DialogHeader>
          <DialogTitle>{t(($) => $['auth.oauthClientSettings'], { ns: 'plugin' })}</DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          {pluginPayload.detail && (
            <ReadmeEntrance pluginDetail={pluginPayload.detail} presentation="dialog" />
          )}
          <AuthForm
            formFromProps={form}
            ref={formRef}
            formSchemas={schemas}
            defaultValues={editValues || defaultValues}
            disabled={disabled}
          />
        </DialogBody>
        <DialogFooter>
          {__oauth_client__ === 'custom' && hasOriginalClientParams && (
            <Button
              variant="secondary"
              className="me-auto text-components-button-destructive-secondary-text"
              disabled={isDisabled || !editValues}
              onClick={handleRemove}
            >
              {t(($) => $['operation.remove'], { ns: 'common' })}
            </Button>
          )}
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={isDisabled}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <div className="mx-1 h-4 w-px bg-divider-regular"></div>
          <Button onClick={handleConfirm} disabled={isDisabled}>
            {t(($) => $['auth.saveOnly'], { ns: 'plugin' })}
          </Button>
          <Button variant="primary" onClick={handleConfirmAndAuthorize} disabled={isDisabled}>
            {t(($) => $['auth.saveAndAuth'], { ns: 'plugin' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default memo(OAuthClientSettings)
