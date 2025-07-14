import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal/modal'
import {
  useInvalidPluginCredentialInfoHook,
  useSetPluginOAuthCustomClientHook,
} from '../hooks/use-credential'
import type { PluginPayload } from '../types'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { transformFormSchemasSecretInput } from '../utils'
import { useToastContext } from '@/app/components/base/toast'

type OAuthClientSettingsProps = {
  pluginPayload: PluginPayload
  onClose?: () => void
  editValues?: Record<string, any>
  disabled?: boolean
  schemas: FormSchema[]
  onAuth?: () => Promise<void>
}
const OAuthClientSettings = ({
  pluginPayload,
  onClose,
  editValues,
  disabled,
  schemas,
  onAuth,
}: OAuthClientSettingsProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const defaultValues = schemas.reduce((acc, schema) => {
    if (schema.default)
      acc[schema.name] = schema.default
    return acc
  }, {} as Record<string, any>)
  const { mutateAsync: setPluginOAuthCustomClient } = useSetPluginOAuthCustomClientHook(pluginPayload)
  const invalidatePluginCredentialInfo = useInvalidPluginCredentialInfoHook(pluginPayload)
  const formRef = useRef<FormRefObject>(null)
  const handleConfirm = useCallback(async () => {
    const form = formRef.current?.getForm()
    const store = form?.store
    const {
      __oauth_client__,
      ...values
    } = store?.state.values
    const isPristineSecretInputNames: string[] = []
    for (let i = 0; i < schemas.length; i++) {
      const schema = schemas[i]
      if (schema.required && !values[schema.name]) {
        notify({
          type: 'error',
          message: t('common.errorMsg.fieldRequired', { field: schema.name }),
        })
        return
      }
      if (schema.type === FormTypeEnum.secretInput) {
        const fieldMeta = form?.getFieldMeta(schema.name)
        if (fieldMeta?.isPristine)
          isPristineSecretInputNames.push(schema.name)
      }
    }

    const transformedValues = transformFormSchemasSecretInput(isPristineSecretInputNames, values)

    await setPluginOAuthCustomClient({
      client_params: transformedValues,
      enable_oauth_custom_client: __oauth_client__ === 'custom',
    })
    notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })

    onClose?.()
    invalidatePluginCredentialInfo()
  }, [onClose, invalidatePluginCredentialInfo, setPluginOAuthCustomClient, notify, t, schemas])

  const handleConfirmAndAuthorize = useCallback(async () => {
    await handleConfirm()
    if (onAuth)
      await onAuth()
  }, [handleConfirm, onAuth])
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
    >
      <AuthForm
        ref={formRef}
        formSchemas={schemas}
        defaultValues={editValues || defaultValues}
        disabled={disabled}
      />
    </Modal>
  )
}

export default memo(OAuthClientSettings)
