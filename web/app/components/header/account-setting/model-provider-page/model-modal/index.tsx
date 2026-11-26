import type { FC, Ref } from 'react'
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
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { ORPCError } from '@orpc/client'
import { memo, useCallback, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import {
  useAuth,
  useCredentialData,
} from '@/app/components/header/account-setting/model-provider-page/model-auth/hooks'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import { toast } from '@/app/notifications'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { isAbortError } from '@/utils/is-abort-error'
import { ConfigurationMethodEnum, FormTypeEnum, ModelModalModeEnum } from '../declarations'
import { useLanguage } from '../hooks'
import { CredentialSelector } from '../model-auth'
import { useModelFormSchemas } from '../model-auth/hooks'

type ModelModalProps = {
  provider: ModelProvider
  configurateMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  ref?: Ref<{ isPending: () => boolean }>
  onSuccess: (savedValues?: Record<string, unknown>) => void
  model?: CustomModel
  credential?: Credential
  isModelCredential?: boolean
  mode?: ModelModalModeEnum
}

const ModelModal: FC<ModelModalProps> = ({
  provider,
  configurateMethod,
  currentCustomConfigurationModelFixedFields,
  ref,
  onSuccess,
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
    doingActionRef,
    handleActiveCredential,
  } = useAuth(provider, configurateMethod, currentCustomConfigurationModelFixedFields, {
    isModelCredential,
    mode,
  })
  const { credentials: formSchemasValue, available_credentials } = credentialData as any

  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const { t } = useTranslation(['common', 'modelProvider'])
  const language = useLanguage()
  const { formSchemas, formValues, modelNameAndTypeFormSchemas } = useModelFormSchemas(
    provider,
    providerFormSchemaPredefined,
    formSchemasValue,
    credential,
    model,
  )
  const [selectedCredential, setSelectedCredential] = useState<
    (Credential & { addNewCredential?: boolean }) | undefined
  >()
  const credentialFormRef = useRef<FormRefObject>(null)
  const isEditMode =
    !!credential &&
    !!Object.keys(formSchemasValue || {}).filter((key) => {
      return key !== '__model_name' && key !== '__model_type' && !!formValues[key]
    }).length &&
    canManageCredential

  const formId = useId()
  useImperativeHandle(ref, () => ({ isPending: () => doingActionRef.current }), [doingActionRef])

  const finish = useCallback(
    async (request: Promise<void>, values?: Record<string, unknown>) => {
      try {
        await request
      } catch (error) {
        // The mutation cache reports failed requests; only a request that never got a response
        // is reported here.
        if (isAbortError(error) || error instanceof ORPCError) return
        toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
        return
      }
      onSuccess(values)
    },
    [onSuccess, t],
  )

  const handleSave = useCallback(() => {
    if (doingActionRef.current) return
    if (
      mode === ModelModalModeEnum.addCustomModelToModelList &&
      selectedCredential &&
      !selectedCredential?.addNewCredential
    ) {
      if (!canUseCredential) return

      void finish(handleActiveCredential(selectedCredential, model))
      return
    }

    const canSubmitCredentialForm = credential ? canManageCredential : canCreateCredential
    if (!canSubmitCredentialForm) return

    const { isCheckValidated, values } = credentialFormRef.current?.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    }) || { isCheckValidated: false, values: {} }
    if (!isCheckValidated) return

    let modelNameAndTypeValues = values
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
    const { __model_name, __model_type } = modelNameAndTypeValues
    const { __authorization_name__, ...rest } = values
    const shouldSaveModelCredential =
      mode === ModelModalModeEnum.configCustomModel ||
      mode === ModelModalModeEnum.configModelCredential ||
      (mode === ModelModalModeEnum.addCustomModelToModelList &&
        selectedCredential?.addNewCredential)
    if (shouldSaveModelCredential && (!__model_name || !__model_type)) return

    void finish(
      handleSaveCredential({
        credential_id: credential?.credential_id,
        credentials: rest,
        name: __authorization_name__,
        ...(shouldSaveModelCredential ? { model: __model_name, model_type: __model_type } : {}),
      }),
      values,
    )
  }, [
    mode,
    selectedCredential,
    model,
    currentCustomConfigurationModelFixedFields,
    canUseCredential,
    canCreateCredential,
    canManageCredential,
    finish,
    doingActionRef,
    handleActiveCredential,
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
          <ModelIcon className="me-2 size-4 shrink-0" provider={provider} />
          <div className="me-1 system-md-regular text-text-secondary">
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
          <ModelIcon className="me-2 size-4 shrink-0" provider={provider} modelName={model.model} />
          <div className="me-1 system-md-regular text-text-secondary">{model.model}</div>
          <Badge>{model.model_type}</Badge>
        </div>
      )
    }

    return null
  }, [model, provider, mode, renderI18nObject])

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

  const fields =
    mode === ModelModalModeEnum.configCustomModel
      ? [...modelNameAndTypeFormSchemas, ...formSchemas]
      : formSchemas
  const notAllowCustomCredential = provider.allow_custom_token === false
  const isOfficialOpenAIProvider =
    provider.provider === ModelProviderQuotaGetPaid.OPENAI || provider.provider === 'openai'

  return (
    <>
      <DialogHeader>
        {modalTitle}
        {modalDesc}
        {modalModel}
        <DialogHeaderCloseButton
          disabled={doingAction}
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        />
      </DialogHeader>
      <DialogBody>
        {mode === ModelModalModeEnum.addCustomModelToModelList && (
          <CredentialSelector
            credentials={available_credentials || []}
            onSelect={setSelectedCredential}
            selectedCredential={selectedCredential}
            disabled={isLoading || doingAction}
            notAllowAddNewCredential={notAllowCustomCredential || !canCreateCredential}
          />
        )}
        {mode === ModelModalModeEnum.addCustomModelToModelList && showCredentialForm && (
          <div className="mt-6 mb-3 flex items-center system-xs-medium-uppercase text-text-tertiary">
            {t(($) => $['modelProvider.auth.modelCredential'], { ns: 'modelProvider' })}
            <div className="ms-2 h-px grow bg-linear-to-r from-divider-regular to-background-gradient-mask-transparent rtl:bg-linear-to-l" />
          </div>
        )}
        {isLoading && (
          <div className="mt-3 flex items-center justify-center">
            <LoadingPlaceholder />
          </div>
        )}
        {!isLoading && showCredentialForm && (
          <AuthForm
            disabled={doingAction}
            id={formId}
            preventDefaultSubmit
            onSubmit={handleSave}
            formSchemas={
              fields.map((formSchema) => {
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
            ref={credentialFormRef}
          />
        )}
      </DialogBody>
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
              className="ms-1 -mt-0.5 i-custom-vender-line-general-link-external-02 inline-block h-3 w-3 align-middle rtl:-scale-x-100"
            />
          </a>
        )}
        {isEditMode && (
          <Button
            variant="primary"
            tone="destructive"
            disabled={doingAction}
            onClick={() => openConfirmDelete(credential, model)}
          >
            {t(($) => $['operation.remove'], { ns: 'common' })}
          </Button>
        )}
        <DialogClose render={<Button disabled={doingAction} />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button
          variant="primary"
          type={showCredentialForm ? 'submit' : 'button'}
          form={showCredentialForm ? formId : undefined}
          onClick={showCredentialForm ? undefined : handleSave}
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

      <AlertDialog
        open={!!deleteCredentialId}
        onOpenChange={(open, details) => {
          if (open) return
          if (doingAction) details.cancel()
          else closeConfirmDelete()
        }}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['modelProvider.confirmDelete'], { ns: 'modelProvider' })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={doingAction}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={doingAction}
              onClick={() => {
                if (!doingActionRef.current) void finish(handleConfirmDelete())
              }}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default memo(ModelModal)
