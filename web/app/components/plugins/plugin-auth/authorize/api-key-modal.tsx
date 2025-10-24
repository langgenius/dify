import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal/modal'
import { CredentialTypeEnum } from '../types'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { useToastContext } from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import type { PluginPayload } from '../types'
import {
  useAddPluginCredentialHook,
  useGetPluginCredentialSchemaHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import { ReadmeEntrance } from '../../readme-panel/entrance'
import { ReadmeShowType } from '../../readme-panel/store'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'

export type ApiKeyModalProps = {
  pluginPayload: PluginPayload
  onClose?: () => void
  editValues?: Record<string, any>
  onRemove?: () => void
  disabled?: boolean
  onUpdate?: () => void
  formSchemas?: FormSchema[]
}
const ApiKeyModal = ({
  pluginPayload,
  onClose,
  editValues,
  onRemove,
  disabled,
  onUpdate,
  formSchemas: formSchemasFromProps = [],
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
  const mergedData = useMemo(() => {
    if (formSchemasFromProps?.length)
      return formSchemasFromProps

    return data
  }, [formSchemasFromProps, data])
  const formSchemas = useMemo(() => {
    return [
      {
        type: FormTypeEnum.textInput,
        name: '__name__',
        label: t('plugin.auth.authorizationName'),
        required: false,
      },
      ...mergedData,
    ]
  }, [mergedData, t])
  const defaultValues = formSchemas.reduce((acc, schema) => {
    if (schema.default)
      acc[schema.name] = schema.default
    return acc
  }, {} as Record<string, any>)
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
        (<div></div>)
      }
      bottomSlot={<EncryptedBottom />}
      onConfirm={handleConfirm}
      showExtraButton={!!editValues}
      onExtraButtonClick={onRemove}
      disabled={disabled || isLoading || doingAction}
      clickOutsideNotClose={true}
    >
      <ReadmeEntrance pluginDetail={pluginPayload.detail} showType={ReadmeShowType.modal} />
      {
        isLoading && (
          <div className='flex h-40 items-center justify-center'>
            <Loading />
          </div>
        )
      }
      {
        !isLoading && !!mergedData.length && (
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
