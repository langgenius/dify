import {
  memo,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal/modal'
import {
  useGetPluginOAuthClientSchemaHook,
  useInvalidPluginCredentialInfoHook,
  useSetPluginOAuthCustomClientHook,
} from '../hooks/use-credential'
import type { PluginPayload } from '../types'
import Loading from '@/app/components/base/loading'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import type { FromRefObject } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { transformFormSchemasSecretInput } from '../utils'
import { useToastContext } from '@/app/components/base/toast'

type OAuthClientSettingsProps = {
  pluginPayload: PluginPayload
  onClose?: () => void
  editValues?: Record<string, any>
  disabled?: boolean
}
const OAuthClientSettings = ({
  pluginPayload,
  onClose,
  editValues,
  disabled,
}: OAuthClientSettingsProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const {
    data,
    isLoading,
  } = useGetPluginOAuthClientSchemaHook(pluginPayload)
  const formSchemas = useMemo(() => {
    return data?.schema || []
  }, [data])
  const defaultValues = formSchemas.reduce((acc, schema) => {
    if (schema.default)
      acc[schema.name] = schema.default
    return acc
  }, {} as Record<string, any>)
  const { mutateAsync: setPluginOAuthCustomClient } = useSetPluginOAuthCustomClientHook(pluginPayload)
  const invalidatePluginCredentialInfo = useInvalidPluginCredentialInfoHook(pluginPayload)
  const formRef = useRef<FromRefObject>(null)
  const handleConfirm = useCallback(async () => {
    const form = formRef.current?.getForm()
    const store = form?.store
    const values = store?.state.values
    const isPristineSecretInputNames: string[] = []
    formSchemas.forEach((schema) => {
      if (schema.type === FormTypeEnum.secretInput) {
        const fieldMeta = form?.getFieldMeta(schema.name)
        if (fieldMeta?.isPristine)
          isPristineSecretInputNames.push(schema.name)
      }
    })

    const transformedValues = transformFormSchemasSecretInput(isPristineSecretInputNames, values)

    await setPluginOAuthCustomClient({
      client_params: transformedValues,
      enable_oauth_custom_client: true,
    })
    notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })

    onClose?.()
    invalidatePluginCredentialInfo()
  }, [onClose, invalidatePluginCredentialInfo, setPluginOAuthCustomClient, notify, t, formSchemas])
  return (
    <Modal
      title='Oauth client settings'
      confirmButtonText='Save & Authorize'
      cancelButtonText='Save only'
      extraButtonText='Cancel'
      showExtraButton
      extraButtonVariant='secondary'
      onExtraButtonClick={onClose}
      onClose={onClose}
      onConfirm={handleConfirm}
    >
      {
        isLoading && (
          <div className='flex h-40 items-center justify-center'>
            <Loading />
          </div>
        )
      }
      {
        !isLoading && !!data?.schema.length && (
          <AuthForm
            ref={formRef}
            formSchemas={formSchemas}
            defaultValues={editValues || defaultValues}
            disabled={disabled}
          />
        )
      }
    </Modal>
  )
}

export default memo(OAuthClientSettings)
