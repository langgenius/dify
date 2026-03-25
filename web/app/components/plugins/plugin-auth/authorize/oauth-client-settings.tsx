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
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@/app/components/base/ui/dialog'
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

      onClose?.()
      onUpdate?.()
      invalidPluginOAuthClientSchema()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [onClose, onUpdate, invalidPluginOAuthClientSchema, setPluginOAuthCustomClient, t, handleSetDoingAction])

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
      onClose?.()
      onUpdate?.()
      invalidPluginOAuthClientSchema()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [onUpdate, invalidPluginOAuthClientSchema, deletePluginOAuthCustomClient, t, handleSetDoingAction, onClose])
  const form = useForm({
    defaultValues: editValues || defaultValues,
  })
  const __oauth_client__ = useStore(form.store, s => s.values.__oauth_client__)
  return (
    <Dialog open>
      <DialogContent className="w-[640px] max-w-none overflow-visible px-8 pb-6 pt-8">
        <DialogCloseButton onClick={onClose} />
        <div className="mb-4 pr-8">
          <DialogTitle className="text-xl font-semibold text-text-primary">
            {t('auth.oauthClientSettings', { ns: 'plugin' })}
          </DialogTitle>
        </div>
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
        <div className="mt-6 flex items-center justify-between">
          <div>
            {__oauth_client__ === 'custom' && hasOriginalClientParams && (
              <Button
                variant="secondary"
                className="text-components-button-destructive-secondary-text"
                disabled={disabled || doingAction || !editValues}
                onClick={handleRemove}
              >
                {t('operation.remove', { ns: 'common' })}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleConfirm} disabled={disabled || doingAction}>
              {t('auth.saveOnly', { ns: 'plugin' })}
            </Button>
            <Button variant="primary" onClick={handleConfirmAndAuthorize} disabled={disabled || doingAction}>
              {t('auth.saveAndAuth', { ns: 'plugin' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(OAuthClientSettings)
