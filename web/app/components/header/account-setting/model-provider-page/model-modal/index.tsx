import type { FC } from 'react'
import type {
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  ModelProvider,
} from '../declarations'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { EncryptedBottom, EncryptedFooter } from '@/app/components/base/encrypted-bottom'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import {
  useAuth,
  useCredentialData,
} from '@/app/components/header/account-setting/model-provider-page/model-auth/hooks'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { ConfigurationMethodEnum, FormTypeEnum, ModelModalModeEnum } from '../declarations'
import { useLanguage } from '../hooks'
import { CredentialSelector } from '../model-auth'
import { useModelFormSchemas } from '../model-auth/hooks'

type ModelModalProps = {
  provider: ModelProvider
  configurateMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  onCancel: () => void
  onSave: (formValues?: Record<string, any>) => void
  onRemove: (formValues?: Record<string, any>) => void
  model?: CustomModel
  credential?: Credential
  isModelCredential?: boolean
  mode?: ModelModalModeEnum
}

const ModelModal: FC<ModelModalProps> = ({
  provider,
  configurateMethod,
  currentCustomConfigurationModelFixedFields,
  onCancel,
  onSave,
  model,
  credential,
  isModelCredential,
  mode = ModelModalModeEnum.configProviderCredential,
}) => {
  const renderI18nObject = useRenderI18nObject()
  const providerFormSchemaPredefined = configurateMethod === ConfigurationMethodEnum.predefinedModel
  const { isLoading, credentialData } = useCredentialData(
    provider,
    providerFormSchemaPredefined,
    isModelCredential,
    credential,
    model,
  )
  const {
    handleSaveCredential,
    handleConfirmDelete,
    deleteCredentialId,
    closeConfirmDelete,
    openConfirmDelete,
    doingAction,
    handleActiveCredential,
  } = useAuth(provider, configurateMethod, currentCustomConfigurationModelFixedFields, {
    isModelCredential,
    mode,
  })
  const { credentials: formSchemasValue, available_credentials } = credentialData as any

  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const { t } = useTranslation(['common', 'modelProvider'])
  const language = useLanguage()
  const { formSchemas, formValues, modelNameAndTypeFormSchemas, modelNameAndTypeFormValues } =
    useModelFormSchemas(provider, providerFormSchemaPredefined, formSchemasValue, credential, model)
  const formRef1 = useRef<FormRefObject>(null)
  const [selectedCredential, setSelectedCredential] = useState<
    (Credential & { addNewCredential?: boolean }) | undefined
  >()
  const formRef2 = useRef<FormRefObject>(null)
  const isEditMode =
    !!credential &&
    !!Object.keys(formSchemasValue || {}).filter((key) => {
      return key !== '__model_name' && key !== '__model_type' && !!formValues[key]
    }).length &&
    canManageCredential

  const handleSave = useCallback(async () => {
    if (
      mode === ModelModalModeEnum.addCustomModelToModelList &&
      selectedCredential &&
      !selectedCredential?.addNewCredential
    ) {
      if (!canUseCredential) return

      handleActiveCredential(selectedCredential, model)
      onCancel()
      return
    }

    const canSubmitCredentialForm = credential ? canManageCredential : canCreateCredential
    if (!canSubmitCredentialForm) return

    let modelNameAndTypeIsCheckValidated = true
    let modelNameAndTypeValues: Record<string, any> = {}

    if (mode === ModelModalModeEnum.configCustomModel) {
      const formResult = formRef1.current?.getFormValues({
        needCheckValidatedValues: true,
      }) || { isCheckValidated: false, values: {} }
      modelNameAndTypeIsCheckValidated = formResult.isCheckValidated
      modelNameAndTypeValues = formResult.values
    }

    if (
      mode === ModelModalModeEnum.configModelCredential ||
      (mode === ModelModalModeEnum.addCustomModelToModelList &&
        selectedCredential?.addNewCredential)
    ) {
      const modelContext =
        model ??
        (currentCustomConfigurationModelFixedFields
          ? {
              model: currentCustomConfigurationModelFixedFields.__model_name,
              model_type: currentCustomConfigurationModelFixedFields.__model_type,
            }
          : undefined)
      if (!modelContext) return

      modelNameAndTypeValues = {
        __model_name: modelContext.model,
        __model_type: modelContext.model_type,
      }
    }
    const { isCheckValidated, values } = formRef2.current?.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    }) || { isCheckValidated: false, values: {} }
    if (!isCheckValidated || !modelNameAndTypeIsCheckValidated) return

    const { __model_name, __model_type } = modelNameAndTypeValues
    const { __authorization_name__, ...rest } = values
    const shouldSaveModelCredential =
      mode === ModelModalModeEnum.configCustomModel ||
      mode === ModelModalModeEnum.configModelCredential ||
      (mode === ModelModalModeEnum.addCustomModelToModelList &&
        selectedCredential?.addNewCredential)
    if (shouldSaveModelCredential) {
      if (!__model_name || !__model_type) return

      await handleSaveCredential({
        credential_id: credential?.credential_id,
        credentials: rest,
        name: __authorization_name__,
        model: __model_name,
        model_type: __model_type,
      })
    } else {
      await handleSaveCredential({
        credential_id: credential?.credential_id,
        credentials: rest,
        name: __authorization_name__,
      })
    }
    onSave(values)
  }, [
    mode,
    selectedCredential,
    model,
    currentCustomConfigurationModelFixedFields,
    canUseCredential,
    canCreateCredential,
    canManageCredential,
    onSave,
    handleActiveCredential,
    onCancel,
    handleSaveCredential,
    credential,
  ])

  const modalTitle = useMemo(() => {
    let label: string = t(($) => $['modelProvider.auth.apiKeyModal.title'], { ns: 'modelProvider' })

    if (
      mode === ModelModalModeEnum.configCustomModel ||
      mode === ModelModalModeEnum.addCustomModelToModelList
    )
      label = t(($) => $['modelProvider.auth.addModel'], { ns: 'modelProvider' })
    if (mode === ModelModalModeEnum.configModelCredential) {
      if (credential)
        label = t(($) => $['modelProvider.auth.editModelCredential'], { ns: 'modelProvider' })
      else label = t(($) => $['modelProvider.auth.addModelCredential'], { ns: 'modelProvider' })
    }

    return <DialogTitle>{label}</DialogTitle>
  }, [t, mode, credential])

  const modalDesc = useMemo(() => {
    if (providerFormSchemaPredefined) {
      return (
        <DialogDescription>
          {t(($) => $['modelProvider.auth.apiKeyModal.desc'], { ns: 'modelProvider' })}
        </DialogDescription>
      )
    }

    return null
  }, [providerFormSchemaPredefined, t])

  const modalModel = useMemo(() => {
    if (mode === ModelModalModeEnum.configCustomModel) {
      return (
        <div className="mt-2 flex items-center">
          <ModelIcon className="mr-2 size-4 shrink-0" provider={provider} />
          <div className="mr-1 system-md-regular text-text-secondary">
            {renderI18nObject(provider.label)}
          </div>
        </div>
      )
    }
    if (
      model &&
      (mode === ModelModalModeEnum.configModelCredential ||
        mode === ModelModalModeEnum.addCustomModelToModelList)
    ) {
      return (
        <div className="mt-2 flex items-center">
          <ModelIcon className="mr-2 size-4 shrink-0" provider={provider} modelName={model.model} />
          <div className="mr-1 system-md-regular text-text-secondary">{model.model}</div>
          <Badge>{model.model_type}</Badge>
        </div>
      )
    }

    return null
  }, [model, provider, mode, renderI18nObject])

  const showCredentialLabel = useMemo(() => {
    if (mode === ModelModalModeEnum.configCustomModel) return true
    if (mode === ModelModalModeEnum.addCustomModelToModelList)
      return selectedCredential?.addNewCredential
  }, [mode, selectedCredential])
  const showCredentialForm = useMemo(() => {
    if (mode !== ModelModalModeEnum.addCustomModelToModelList) return true
    return selectedCredential?.addNewCredential
  }, [mode, selectedCredential])
  const saveButtonText = useMemo(() => {
    if (
      mode === ModelModalModeEnum.addCustomModelToModelList ||
      mode === ModelModalModeEnum.configCustomModel
    )
      return t(($) => $['operation.add'], { ns: 'common' })
    return t(($) => $['operation.save'], { ns: 'common' })
  }, [mode, t])
  const canSaveCredentialChange =
    mode === ModelModalModeEnum.addCustomModelToModelList &&
    selectedCredential &&
    !selectedCredential.addNewCredential
      ? canUseCredential
      : credential
        ? canManageCredential
        : canCreateCredential

  const handleDeleteCredential = useCallback(() => {
    handleConfirmDelete()
    onCancel()
  }, [handleConfirmDelete, onCancel])

  const handleModelNameAndTypeChange = useCallback((field: string, value: any) => {
    const { getForm } = (formRef2.current as FormRefObject) || {}
    if (getForm()) getForm()?.setFieldValue(field, value)
  }, [])
  const notAllowCustomCredential = provider.allow_custom_token === false
  const isOfficialOpenAIProvider =
    provider.provider === ModelProviderQuotaGetPaid.OPENAI || provider.provider === 'openai'

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onCancel()
    },
    [onCancel],
  )

  const handleConfirmOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeConfirmDelete()
    },
    [closeConfirmDelete],
  )

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent backdropProps={{ forceRender: true }} className="w-160 max-w-160">
        <DialogHeader>
          {modalTitle}
          {modalDesc}
          {modalModel}
          <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          {mode === ModelModalModeEnum.configCustomModel && (
            <AuthForm
              formSchemas={
                modelNameAndTypeFormSchemas.map((formSchema) => {
                  return {
                    ...formSchema,
                    name: formSchema.variable,
                  }
                }) as FormSchema[]
              }
              defaultValues={modelNameAndTypeFormValues}
              inputClassName="justify-start"
              ref={formRef1}
              onChange={handleModelNameAndTypeChange}
            />
          )}
          {mode === ModelModalModeEnum.addCustomModelToModelList && (
            <CredentialSelector
              credentials={available_credentials || []}
              onSelect={setSelectedCredential}
              selectedCredential={selectedCredential}
              disabled={isLoading}
              notAllowAddNewCredential={notAllowCustomCredential || !canCreateCredential}
            />
          )}
          {showCredentialLabel && (
            <div className="mt-6 mb-3 flex items-center system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $['modelProvider.auth.modelCredential'], { ns: 'modelProvider' })}
              <div className="ml-2 h-px grow bg-linear-to-r from-divider-regular to-background-gradient-mask-transparent" />
            </div>
          )}
          {isLoading && (
            <div className="mt-3 flex items-center justify-center">
              <LoadingPlaceholder />
            </div>
          )}
          {!isLoading && showCredentialForm && (
            <AuthForm
              formSchemas={
                formSchemas.map((formSchema) => {
                  return {
                    ...formSchema,
                    name: formSchema.variable,
                    showRadioUI: formSchema.type === FormTypeEnum.radio,
                    ...(isOfficialOpenAIProvider && formSchema.variable === 'api_protocol'
                      ? {
                          description: t(($) => $['modelProvider.auth.openAIResponsesAPITip'], {
                            ns: 'modelProvider',
                          }),
                        }
                      : {}),
                  }
                }) as FormSchema[]
              }
              defaultValues={formValues}
              inputClassName="justify-start"
              ref={formRef2}
            />
          )}
        </DialogBody>
        <EncryptedFooter>
          <DialogFooter>
            {provider.help && (provider.help.title || provider.help.url) && (
              <a
                href={provider.help?.url[language] || provider.help?.url.en_US}
                target="_blank"
                rel="noopener noreferrer"
                className="me-auto inline-block align-middle system-xs-regular text-text-accent"
                onClick={(e) => !provider.help?.url && e.preventDefault()}
              >
                {provider.help.title?.[language] ||
                  provider.help.url[language] ||
                  provider.help.title?.en_US ||
                  provider.help.url.en_US}
                <span
                  aria-hidden
                  className="-mt-0.5 ml-1 i-custom-vender-line-general-link-external-02 inline-block h-3 w-3 align-middle"
                />
              </a>
            )}
            {isEditMode && (
              <Button
                variant="primary"
                tone="destructive"
                onClick={() => openConfirmDelete(credential, model)}
              >
                {t(($) => $['operation.remove'], { ns: 'common' })}
              </Button>
            )}
            <Button onClick={onCancel}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={isLoading || doingAction || !canSaveCredentialChange}
            >
              {saveButtonText}
            </Button>
          </DialogFooter>
          {(mode === ModelModalModeEnum.configCustomModel ||
            mode === ModelModalModeEnum.configProviderCredential) && (
            <EncryptedBottom
              front={t(($) => $['modelProvider.encrypted.front'], { ns: 'modelProvider' })}
              back={t(($) => $['modelProvider.encrypted.back'], { ns: 'modelProvider' })}
            />
          )}
        </EncryptedFooter>
      </DialogContent>
      <AlertDialog open={!!deleteCredentialId} onOpenChange={handleConfirmOpenChange}>
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['modelProvider.confirmDelete'], { ns: 'modelProvider' })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={doingAction} onClick={handleDeleteCredential}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

export default memo(ModelModal)
