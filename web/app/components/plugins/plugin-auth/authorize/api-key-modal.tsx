import type { PluginPayload } from '../types'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Loading from '@/app/components/base/loading'
import { ReadmeEntrance } from '../../readme-panel/entrance'
import {
  useAddPluginCredentialHook,
  useGetPluginCredentialSchemaHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'
import { CredentialTypeEnum } from '../types'

export type ApiKeyModalProps = {
  pluginPayload: PluginPayload
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  editValues?: Record<string, unknown>
  onRemove?: () => void
  disabled?: boolean
  onUpdate?: () => void
  formSchemas?: FormSchema[]
}
const ApiKeyModal = ({
  pluginPayload,
  open = true,
  onOpenChange,
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

      onOpenChange?.(false)
      onClose?.()
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [addPluginCredential, onClose, onOpenChange, onUpdate, updatePluginCredential, t, editValues, handleSetDoingAction])

  const isDisabled = disabled || isLoading || doingAction
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    onOpenChange?.(nextOpen)
    if (!nextOpen)
      onClose?.()
  }, [onClose, onOpenChange])

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="w-[640px]! max-w-[calc(100vw-2rem)]! p-0!"
      >
        <div data-testid="modal" className="flex max-h-[80dvh] flex-col">
          <div className="relative shrink-0 p-6 pr-14 pb-3">
            <DialogTitle data-testid="modal-title" className="title-2xl-semi-bold text-text-primary">
              {t('auth.useApiAuth', { ns: 'plugin' })}
            </DialogTitle>
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {t('auth.useApiAuthDesc', { ns: 'plugin' })}
            </div>
            <DialogCloseButton
              className="top-5 right-5 h-8 w-8 rounded-lg"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
            {pluginPayload.detail && (
              <ReadmeEntrance pluginDetail={pluginPayload.detail} presentation="dialog" />
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
          </div>
          <div className="flex shrink-0 justify-between p-6 pt-5">
            <div />
            <div className="flex items-center">
              {editValues && (
                <>
                  <Button
                    data-testid="modal-extra"
                    variant="primary"
                    onClick={onRemove}
                    disabled={isDisabled}
                  >
                    {t('operation.remove', { ns: 'common' })}
                  </Button>
                  <div className="mx-3 h-4 w-px bg-divider-regular"></div>
                </>
              )}
              <Button
                onClick={() => handleOpenChange(false)}
                disabled={isDisabled}
              >
                {t('operation.cancel', { ns: 'common' })}
              </Button>
              <Button
                data-testid="modal-confirm"
                className="ml-2"
                variant="primary"
                onClick={handleConfirm}
                disabled={isDisabled}
              >
                {t('operation.save', { ns: 'common' })}
              </Button>
            </div>
          </div>
          <div className="shrink-0">
            <EncryptedBottom />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(ApiKeyModal)
