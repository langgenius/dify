import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import {
  useForm,
  useStore,
} from '@tanstack/react-form'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal/modal'
import {
  useDeletePluginOAuthCustomClientHook,
  useInvalidPluginOAuthClientSchemaHook,
  useSetPluginOAuthCustomClientHook,
} from '../hooks/use-credential'
import type { PluginPayload } from '../types'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import { useToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'

type OAuthClientSettingsProps = {
  pluginPayload: PluginPayload
  onClose?: () => void
  editValues?: Record<string, any>
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
  const { notify } = useToastContext()
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
  }, {} as Record<string, any>)
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
      notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })

      onClose?.()
      onUpdate?.()
      invalidPluginOAuthClientSchema()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [onClose, onUpdate, invalidPluginOAuthClientSchema, setPluginOAuthCustomClient, notify, t, handleSetDoingAction])

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
      notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
      onClose?.()
      onUpdate?.()
      invalidPluginOAuthClientSchema()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [onUpdate, invalidPluginOAuthClientSchema, deletePluginOAuthCustomClient, notify, t, handleSetDoingAction, onClose])
  const form = useForm({
    defaultValues: editValues || defaultValues,
  })
  const __oauth_client__ = useStore(form.store, s => s.values.__oauth_client__)
  return (
    <Modal
      title={t('plugin.auth.oauthClientSettings')}
      confirmButtonText={t('plugin.auth.saveAndAuth')}
      cancelButtonText={t('plugin.auth.saveOnly')}
      extraButtonText={t('common.operation.cancel')}
      showExtraButton
      extraButtonVariant='secondary'
      onExtraButtonClick={onClose}
      onClose={onClose}
      onCancel={handleConfirm}
      onConfirm={handleConfirmAndAuthorize}
      disabled={disabled || doingAction}
      footerSlot={
        __oauth_client__ === 'custom' && hasOriginalClientParams && (
          <div className='grow'>
            <Button
              variant='secondary'
              className='text-components-button-destructive-secondary-text'
              disabled={disabled || doingAction || !editValues}
              onClick={handleRemove}
            >
              {t('common.operation.remove')}
            </Button>
          </div>
        )
      }
    >
      <>
        <AuthForm
          formFromProps={form}
          ref={formRef}
          formSchemas={schemas}
          defaultValues={editValues || defaultValues}
          disabled={disabled}
        />
      </>
    </Modal>
  )
}

export default memo(OAuthClientSettings)
