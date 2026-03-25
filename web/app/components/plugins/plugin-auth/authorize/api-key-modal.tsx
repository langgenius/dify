import type { PluginPayload } from '../types'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Loading from '@/app/components/base/loading'
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
  useAddPluginCredentialHook,
  useGetPluginCredentialSchemaHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import { CredentialTypeEnum } from '../types'

export type ApiKeyModalProps = {
  pluginPayload: PluginPayload
  onClose?: () => void
  editValues?: Record<string, unknown>
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
        label: t('auth.authorizationName', { ns: 'plugin' }),
        required: false,
      },
      ...mergedData,
    ]
  }, [mergedData, t])
  const defaultValues = formSchemas.reduce((acc, schema) => {
    if (schema.default)
      acc[schema.name] = schema.default
    return acc
  }, {} as Record<string, unknown>)
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
      toast.success(t('api.actionSuccess', { ns: 'common' }))

      onClose?.()
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [addPluginCredential, onClose, onUpdate, updatePluginCredential, t, editValues, handleSetDoingAction])

  return (
    <Dialog open>
      <DialogContent className="w-[640px] max-w-none overflow-visible px-8 pb-6 pt-8">
        <DialogCloseButton onClick={onClose} />
        <div className="mb-2 pr-8 text-xl font-semibold text-text-primary">
          <DialogTitle>
            {t('auth.useApiAuth', { ns: 'plugin' })}
          </DialogTitle>
        </div>
        <div className="mb-4 text-sm font-medium leading-5 text-text-secondary">
          {t('auth.useApiAuthDesc', { ns: 'plugin' })}
        </div>
        {pluginPayload.detail && (
          <ReadmeEntrance pluginDetail={pluginPayload.detail} showType={ReadmeShowType.modal} />
        )}
        {
          isLoading && (
            <div className="flex h-40 items-center justify-center">
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
        <div className="mt-6 flex items-center justify-between">
          <div>
            {!!editValues && (
              <Button variant="warning" onClick={onRemove} disabled={disabled || isLoading || doingAction}>
                {t('operation.remove', { ns: 'common' })}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onClose} disabled={disabled || isLoading || doingAction}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button variant="primary" onClick={handleConfirm} disabled={disabled || isLoading || doingAction}>
              {t('operation.save', { ns: 'common' })}
            </Button>
          </div>
        </div>
        <EncryptedBottom />
      </DialogContent>
    </Dialog>
  )
}

export default memo(ApiKeyModal)
