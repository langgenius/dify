import type { PluginPayload } from '../types'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import {
  useForm,
  useStore,
} from '@tanstack/react-form'
import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { toast } from '@/app/components/base/ui/toast'
import { ReadmeEntrance } from '../../readme-panel/entrance'
import { ReadmeShowType } from '../../readme-panel/store'
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
  onAuth?: () => Promise<void>
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
  onAuth,
  hasOriginalClientParams,
  onUpdate,
}: OAuthClientSettingsProps) => {
  const { t } = useTranslation()
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((value: boolean) => {
    doingActionRef.current = value
    setDoingAction(value)
  }, [])
  const handleClose = useCallback(() => {
    onOpenChange?.(false)
    onClose?.()
  }, [onClose, onOpenChange])
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    onOpenChange?.(nextOpen)
    if (!nextOpen)
      onClose?.()
  }, [onClose, onOpenChange])
  const defaultValues = schemas.reduce((acc, schema) => {
    if (schema.default)
      acc[schema.name] = schema.default
    return acc
  }, {} as Record<string, unknown>)
  const { mutateAsync: setPluginOAuthCustomClient } = useSetPluginOAuthCustomClientHook(pluginPayload)
  const invalidPluginOAuthClientSchema = useInvalidPluginOAuthClientSchemaHook(pluginPayload)
  const formRef = useRef<FormRefObject>(null)
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current)
      return

    try {
      const {
        isCheckValidated,
        values,
      } = formRef.current?.getFormValues({
        needCheckValidatedValues: true,
        needTransformWhenSecretFieldIsPristine: true,
      }) || { isCheckValidated: false, values: {} }
      if (!isCheckValidated)
        throw new Error('error')
      const {
        __oauth_client__,
        ...restValues
      } = values

      handleSetDoingAction(true)
      await setPluginOAuthCustomClient({
        client_params: restValues,
        enable_oauth_custom_client: __oauth_client__ === 'custom',
      })
      toast.success(t('api.actionSuccess', { ns: 'common' }))

      onOpenChange?.(false)
      onClose?.()
      onUpdate?.()
      invalidPluginOAuthClientSchema()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [handleSetDoingAction, setPluginOAuthCustomClient, t, onOpenChange, onClose, onUpdate, invalidPluginOAuthClientSchema])

  const handleConfirmAndAuthorize = useCallback(async () => {
    await handleConfirm()
    if (onAuth)
      await onAuth()
  }, [handleConfirm, onAuth])
  const { mutateAsync: deletePluginOAuthCustomClient } = useDeletePluginOAuthCustomClientHook(pluginPayload)
  const handleRemove = useCallback(async () => {
    if (doingActionRef.current)
      return

    try {
      handleSetDoingAction(true)
      await deletePluginOAuthCustomClient()
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      onOpenChange?.(false)
      onClose?.()
      onUpdate?.()
      invalidPluginOAuthClientSchema()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [handleSetDoingAction, deletePluginOAuthCustomClient, t, onOpenChange, onClose, onUpdate, invalidPluginOAuthClientSchema])
  const form = useForm({
    defaultValues: editValues || defaultValues,
  })
  const __oauth_client__ = useStore(form.store, s => s.values.__oauth_client__)
  const isDisabled = disabled || doingAction

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={handleOpenChange}
    >
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="w-[480px] max-w-[calc(100vw-2rem)] p-0"
      >
        <div data-testid="modal" className="flex max-h-[80dvh] flex-col">
          <div className="relative shrink-0 p-6 pb-3 pr-14">
            <DialogTitle data-testid="modal-title" className="text-text-primary title-2xl-semi-bold">
              {t('auth.oauthClientSettings', { ns: 'plugin' })}
            </DialogTitle>
            <DialogCloseButton
              className="right-5 top-5 size-8 rounded-lg"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3 pt-0">
            {pluginPayload.detail && (
              <ReadmeEntrance pluginDetail={pluginPayload.detail} showType={ReadmeShowType.modal} />
            )}
            <AuthForm
              formFromProps={form}
              ref={formRef}
              formSchemas={schemas}
              defaultValues={editValues || defaultValues}
              disabled={disabled}
            />
          </div>
          <div className="flex shrink-0 justify-between p-6 pt-5">
            <div>
              {
                __oauth_client__ === 'custom' && hasOriginalClientParams && (
                  <div className="grow">
                    <Button
                      variant="secondary"
                      className="text-components-button-destructive-secondary-text"
                      disabled={isDisabled || !editValues}
                      onClick={handleRemove}
                    >
                      {t('operation.remove', { ns: 'common' })}
                    </Button>
                  </div>
                )
              }
            </div>
            <div className="flex items-center">
              <Button
                variant="secondary"
                onClick={handleClose}
                disabled={isDisabled}
              >
                {t('operation.cancel', { ns: 'common' })}
              </Button>
              <div className="mx-3 h-4 w-[1px] bg-divider-regular"></div>
              <Button
                onClick={handleConfirm}
                disabled={isDisabled}
              >
                {t('auth.saveOnly', { ns: 'plugin' })}
              </Button>
              <Button
                className="ml-2"
                variant="primary"
                onClick={handleConfirmAndAuthorize}
                disabled={isDisabled}
              >
                {t('auth.saveAndAuth', { ns: 'plugin' })}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(OAuthClientSettings)
