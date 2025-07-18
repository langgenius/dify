import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiExternalLinkLine } from '@remixicon/react'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Modal from '@/app/components/base/modal/modal'
import { CredentialTypeEnum } from '../types'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import type { FormRefObject } from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useToastContext } from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import type { PluginPayload } from '../types'
import {
  useAddPluginCredentialHook,
  useGetPluginCredentialSchemaHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import { useRenderI18nObject } from '@/hooks/use-i18n'

export type ApiKeyModalProps = {
  pluginPayload: PluginPayload
  onClose?: () => void
  editValues?: Record<string, any>
  onRemove?: () => void
  disabled?: boolean
  onUpdate?: () => void
}
const ApiKeyModal = ({
  pluginPayload,
  onClose,
  editValues,
  onRemove,
  disabled,
  onUpdate,
}: ApiKeyModalProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((value: boolean) => {
    doingActionRef.current = value
    setDoingAction(value)
  }, [])
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
  const helpField = formSchemas.find(schema => schema.url && schema.help)
  const renderI18nObject = useRenderI18nObject()
  const { mutateAsync: addPluginCredential } = useAddPluginCredentialHook(pluginPayload)
  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)
  const formRef = useRef<FormRefObject>(null)
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current)
      return
    const {
      isCheckValidated,
      values,
    } = formRef.current?.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    }) || { isCheckValidated: false, values: {} }
    if (!isCheckValidated)
      return

    try {
      const {
        __name__,
        __credential_id__,
        ...restValues
      } = values

      handleSetDoingAction(true)
      if (editValues) {
        await updatePluginCredential({
          credentials: restValues,
          credential_id: __credential_id__,
          name: __name__ || '',
        })
      }
      else {
        await addPluginCredential({
          credentials: restValues,
          type: CredentialTypeEnum.API_KEY,
          name: __name__ || '',
        })
      }
      notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })

      onClose?.()
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [addPluginCredential, onClose, onUpdate, updatePluginCredential, notify, t, editValues, handleSetDoingAction])

  return (
    <Modal
      size='md'
      title={t('plugin.auth.useApiAuth')}
      subTitle={t('plugin.auth.useApiAuthDesc')}
      onClose={onClose}
      onCancel={onClose}
      footerSlot={
        helpField && (
          <a
            className='system-xs-regular mr-2 flex items-center py-2 text-text-accent'
            href={helpField?.url}
            target='_blank'
          >
            <span className='break-all'>
              {renderI18nObject(helpField?.help as any)}
            </span>
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
      disabled={disabled || isLoading || doingAction}
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
