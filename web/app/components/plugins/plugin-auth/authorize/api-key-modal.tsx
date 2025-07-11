import {
  memo,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiExternalLinkLine } from '@remixicon/react'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Modal from '@/app/components/base/modal/modal'
import { CredentialTypeEnum } from '../types'
import { transformFormSchemasSecretInput } from '../utils'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import type { FromRefObject } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useToastContext } from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import type { PluginPayload } from '../types'
import {
  useAddPluginCredentialHook,
  useGetPluginCredentialSchemaHook,
  useInvalidPluginCredentialInfoHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import { useRenderI18nObject } from '@/hooks/use-i18n'

export type ApiKeyModalProps = {
  pluginPayload: PluginPayload
  onClose?: () => void
  editValues?: Record<string, any>
  onRemove?: () => void
  disabled?: boolean
}
const ApiKeyModal = ({
  pluginPayload,
  onClose,
  editValues,
  onRemove,
  disabled,
}: ApiKeyModalProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { data = [], isLoading } = useGetPluginCredentialSchemaHook(pluginPayload, CredentialTypeEnum.API_KEY)
  const formSchemas = useMemo(() => {
    return [
      {
        type: FormTypeEnum.textInput,
        name: '__name__',
        label: t('plugin.auth.authorizationName'),
        required: false,
      },
      ...data,
    ]
  }, [data, t])
  const defaultValues = formSchemas.reduce((acc, schema) => {
    if (schema.default)
      acc[schema.name] = schema.default
    return acc
  }, {} as Record<string, any>)
  const secretInput = formSchemas.find(schema => schema.type === FormTypeEnum.secretInput)
  const renderI18nObject = useRenderI18nObject()
  const { mutateAsync: addPluginCredential } = useAddPluginCredentialHook(pluginPayload)
  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)
  const invalidatePluginCredentialInfo = useInvalidPluginCredentialInfoHook(pluginPayload)
  const formRef = useRef<FromRefObject>(null)
  const handleConfirm = useCallback(async () => {
    const form = formRef.current?.getForm()
    const store = form?.store
    const {
      __name__,
      __credential_id__,
      ...values
    } = store?.state.values
    const isPristineSecretInputNames: string[] = []
    formSchemas.forEach((schema) => {
      if (schema.type === FormTypeEnum.secretInput) {
        const fieldMeta = form?.getFieldMeta(schema.name)
        if (fieldMeta?.isPristine)
          isPristineSecretInputNames.push(schema.name)
      }
    })

    const transformedValues = transformFormSchemasSecretInput(isPristineSecretInputNames, values)

    if (editValues) {
      await updatePluginCredential({
        credentials: transformedValues,
        credential_id: __credential_id__,
        name: __name__ || '',
      })
    }
    else {
      await addPluginCredential({
        credentials: transformedValues,
        type: CredentialTypeEnum.API_KEY,
        name: __name__ || '',
      })
    }
    notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })

    onClose?.()
    invalidatePluginCredentialInfo()
  }, [addPluginCredential, onClose, invalidatePluginCredentialInfo, updatePluginCredential, notify, t, editValues, formSchemas])

  return (
    <Modal
      size='md'
      title={t('plugin.auth.useApiAuth')}
      subTitle={t('plugin.auth.useApiAuthDesc')}
      onClose={onClose}
      onCancel={onClose}
      footerSlot={
        secretInput && (
          <a
            className='system-xs-regular flex h-8 grow items-center text-text-accent'
            href={secretInput?.url}
            target='_blank'
          >
            {renderI18nObject(secretInput?.help as any)}
            <RiExternalLinkLine className='ml-1 h-3 w-3' />
          </a>
        )
      }
      bottomSlot={
        <div className='flex items-center justify-center bg-background-section-burn py-3 text-xs text-text-tertiary'>
          <Lock01 className='mr-1 h-3 w-3 text-text-tertiary' />
          {t('common.modelProvider.encrypted.front')}
          <a
            className='mx-1 text-text-accent'
            target='_blank' rel='noopener noreferrer'
            href='https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html'
          >
            PKCS1_OAEP
          </a>
          {t('common.modelProvider.encrypted.back')}
        </div>
      }
      onConfirm={handleConfirm}
      showExtraButton={!!editValues}
      onExtraButtonClick={onRemove}
      disabled={disabled}
    >
      {
        isLoading && (
          <div className='flex h-40 items-center justify-center'>
            <Loading />
          </div>
        )
      }
      {
        !isLoading && !!data.length && (
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

export default memo(ApiKeyModal)
