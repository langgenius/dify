import type { FC } from 'react'
import type {
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  ModelProvider,
} from '../declarations'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import { RiCloseLine } from '@remixicon/react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Loading from '@/app/components/base/loading'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import {
  useAuth,
  useCredentialData,
} from '@/app/components/header/account-setting/model-provider-page/model-auth/hooks'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import { useAppContext } from '@/context/app-context'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
  ModelModalModeEnum,
} from '../declarations'
import {
  useLanguage,
} from '../hooks'
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
  const {
    isLoading,
    credentialData,
  } = useCredentialData(provider, providerFormSchemaPredefined, isModelCredential, credential, model)
  const {
    handleSaveCredential,
    handleConfirmDelete,
    deleteCredentialId,
    closeConfirmDelete,
    openConfirmDelete,
    doingAction,
    handleActiveCredential,
  } = useAuth(
    provider,
    configurateMethod,
    currentCustomConfigurationModelFixedFields,
    {
      isModelCredential,
      mode,
    },
  )
  const {
    credentials: formSchemasValue,
    available_credentials,
  } = credentialData as any

  const { isCurrentWorkspaceManager } = useAppContext()
  const { t } = useTranslation()
  const language = useLanguage()
  const {
    formSchemas,
    formValues,
    modelNameAndTypeFormSchemas,
    modelNameAndTypeFormValues,
  } = useModelFormSchemas(provider, providerFormSchemaPredefined, formSchemasValue, credential, model)
  const formRef1 = useRef<FormRefObject>(null)
  const [selectedCredential, setSelectedCredential] = useState<Credential & { addNewCredential?: boolean } | undefined>()
  const formRef2 = useRef<FormRefObject>(null)
  const isEditMode = !!credential && !!Object.keys(formSchemasValue || {}).filter((key) => {
    return key !== '__model_name' && key !== '__model_type' && !!formValues[key]
  }).length && isCurrentWorkspaceManager

  const handleSave = useCallback(async () => {
    if (mode === ModelModalModeEnum.addCustomModelToModelList && selectedCredential && !selectedCredential?.addNewCredential) {
      handleActiveCredential(selectedCredential, model)
      onCancel()
      return
    }

    let modelNameAndTypeIsCheckValidated = true
    let modelNameAndTypeValues: Record<string, any> = {}

    if (mode === ModelModalModeEnum.configCustomModel) {
      const formResult = formRef1.current?.getFormValues({
        needCheckValidatedValues: true,
      }) || { isCheckValidated: false, values: {} }
      modelNameAndTypeIsCheckValidated = formResult.isCheckValidated
      modelNameAndTypeValues = formResult.values
    }

    if (mode === ModelModalModeEnum.configModelCredential && model) {
      modelNameAndTypeValues = {
        __model_name: model.model,
        __model_type: model.model_type,
      }
    }

    if (mode === ModelModalModeEnum.addCustomModelToModelList && selectedCredential?.addNewCredential && model) {
      modelNameAndTypeValues = {
        __model_name: model.model,
        __model_type: model.model_type,
      }
    }
    const {
      isCheckValidated,
      values,
    } = formRef2.current?.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    }) || { isCheckValidated: false, values: {} }
    if (!isCheckValidated || !modelNameAndTypeIsCheckValidated)
      return

    const {
      __model_name,
      __model_type,
    } = modelNameAndTypeValues
    const {
      __authorization_name__,
      ...rest
    } = values
    if (__model_name && __model_type) {
      await handleSaveCredential({
        credential_id: credential?.credential_id,
        credentials: rest,
        name: __authorization_name__,
        model: __model_name,
        model_type: __model_type,
      })
    }
    else {
      await handleSaveCredential({
        credential_id: credential?.credential_id,
        credentials: rest,
        name: __authorization_name__,
      })
    }
    onSave(values)
  }, [handleSaveCredential, credential?.credential_id, model, onSave, mode, selectedCredential, handleActiveCredential])

  const modalTitle = useMemo(() => {
    let label = t('modelProvider.auth.apiKeyModal.title', { ns: 'common' })

    if (mode === ModelModalModeEnum.configCustomModel || mode === ModelModalModeEnum.addCustomModelToModelList)
      label = t('modelProvider.auth.addModel', { ns: 'common' })
    if (mode === ModelModalModeEnum.configModelCredential) {
      if (credential)
        label = t('modelProvider.auth.editModelCredential', { ns: 'common' })
      else
        label = t('modelProvider.auth.addModelCredential', { ns: 'common' })
    }

    return (
      <div className="title-2xl-semi-bold text-text-primary">
        {label}
      </div>
    )
  }, [t, mode, credential])

  const modalDesc = useMemo(() => {
    if (providerFormSchemaPredefined) {
      return (
        <div className="system-xs-regular mt-1 text-text-tertiary">
          {t('modelProvider.auth.apiKeyModal.desc', { ns: 'common' })}
        </div>
      )
    }

    return null
  }, [providerFormSchemaPredefined, t])

  const modalModel = useMemo(() => {
    if (mode === ModelModalModeEnum.configCustomModel) {
      return (
        <div className="mt-2 flex items-center">
          <ModelIcon
            className="mr-2 h-4 w-4 shrink-0"
            provider={provider}
          />
          <div className="system-md-regular mr-1 text-text-secondary">{renderI18nObject(provider.label)}</div>
        </div>
      )
    }
    if (model && (mode === ModelModalModeEnum.configModelCredential || mode === ModelModalModeEnum.addCustomModelToModelList)) {
      return (
        <div className="mt-2 flex items-center">
          <ModelIcon
            className="mr-2 h-4 w-4 shrink-0"
            provider={provider}
            modelName={model.model}
          />
          <div className="system-md-regular mr-1 text-text-secondary">{model.model}</div>
          <Badge>{model.model_type}</Badge>
        </div>
      )
    }

    return null
  }, [model, provider, mode, renderI18nObject])

  const showCredentialLabel = useMemo(() => {
    if (mode === ModelModalModeEnum.configCustomModel)
      return true
    if (mode === ModelModalModeEnum.addCustomModelToModelList)
      return selectedCredential?.addNewCredential
  }, [mode, selectedCredential])
  const showCredentialForm = useMemo(() => {
    if (mode !== ModelModalModeEnum.addCustomModelToModelList)
      return true
    return selectedCredential?.addNewCredential
  }, [mode, selectedCredential])
  const saveButtonText = useMemo(() => {
    if (mode === ModelModalModeEnum.addCustomModelToModelList || mode === ModelModalModeEnum.configCustomModel)
      return t('operation.add', { ns: 'common' })
    return t('operation.save', { ns: 'common' })
  }, [mode, t])

  const handleDeleteCredential = useCallback(() => {
    handleConfirmDelete()
    onCancel()
  }, [handleConfirmDelete])

  const handleModelNameAndTypeChange = useCallback((field: string, value: any) => {
    const {
      getForm,
    } = formRef2.current as FormRefObject || {}
    if (getForm())
      getForm()?.setFieldValue(field, value)
  }, [])
  const notAllowCustomCredential = provider.allow_custom_token === false

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onCancel])

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent className="z-[60] h-full w-full">
        <div className="fixed inset-0 flex items-center justify-center bg-black/[.25]">
          <div className="relative w-[640px] rounded-2xl bg-components-panel-bg shadow-xl">
            <div
              className="absolute right-5 top-5 flex h-8 w-8 cursor-pointer items-center justify-center"
              onClick={onCancel}
            >
              <RiCloseLine className="h-4 w-4 text-text-tertiary" />
            </div>
            <div className="p-6 pb-3">
              {modalTitle}
              {modalDesc}
              {modalModel}
            </div>
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto px-6 py-3">
              {
                mode === ModelModalModeEnum.configCustomModel && (
                  <AuthForm
                    formSchemas={modelNameAndTypeFormSchemas.map((formSchema) => {
                      return {
                        ...formSchema,
                        name: formSchema.variable,
                      }
                    }) as FormSchema[]}
                    defaultValues={modelNameAndTypeFormValues}
                    inputClassName="justify-start"
                    ref={formRef1}
                    onChange={handleModelNameAndTypeChange}
                  />
                )
              }
              {
                mode === ModelModalModeEnum.addCustomModelToModelList && (
                  <CredentialSelector
                    credentials={available_credentials || []}
                    onSelect={setSelectedCredential}
                    selectedCredential={selectedCredential}
                    disabled={isLoading}
                    notAllowAddNewCredential={notAllowCustomCredential}
                  />
                )
              }
              {
                showCredentialLabel && (
                  <div className="system-xs-medium-uppercase mb-3 mt-6 flex items-center text-text-tertiary">
                    {t('modelProvider.auth.modelCredential', { ns: 'common' })}
                    <div className="ml-2 h-px grow bg-gradient-to-r from-divider-regular to-background-gradient-mask-transparent" />
                  </div>
                )
              }
              {
                isLoading && (
                  <div className="mt-3 flex items-center justify-center">
                    <Loading />
                  </div>
                )
              }
              {
                !isLoading
                && showCredentialForm
                && (
                  <AuthForm
                    formSchemas={formSchemas.map((formSchema) => {
                      return {
                        ...formSchema,
                        name: formSchema.variable,
                        showRadioUI: formSchema.type === FormTypeEnum.radio,
                      }
                    }) as FormSchema[]}
                    defaultValues={formValues}
                    inputClassName="justify-start"
                    ref={formRef2}
                  />
                )
              }
            </div>
            <div className="flex justify-between p-6 pt-5">
              {
                (provider.help && (provider.help.title || provider.help.url))
                  ? (
                      <a
                        href={provider.help?.url[language] || provider.help?.url.en_US}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="system-xs-regular mt-2 inline-block  align-middle text-text-accent"
                        onClick={e => !provider.help.url && e.preventDefault()}
                      >
                        {provider.help.title?.[language] || provider.help.url[language] || provider.help.title?.en_US || provider.help.url.en_US}
                        <LinkExternal02 className="ml-1 mt-[-2px] inline-block h-3 w-3" />
                      </a>
                    )
                  : <div />
              }
              <div className="ml-2 flex items-center justify-end space-x-2">
                {
                  isEditMode && (
                    <Button
                      variant="warning"
                      onClick={() => openConfirmDelete(credential, model)}
                    >
                      {t('operation.remove', { ns: 'common' })}
                    </Button>
                  )
                }
                <Button
                  onClick={onCancel}
                >
                  {t('operation.cancel', { ns: 'common' })}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={isLoading || doingAction}
                >
                  {saveButtonText}
                </Button>
              </div>
            </div>
            {
              (mode === ModelModalModeEnum.configCustomModel || mode === ModelModalModeEnum.configProviderCredential) && (
                <div className="border-t-[0.5px] border-t-divider-regular">
                  <div className="flex items-center justify-center rounded-b-2xl bg-background-section-burn py-3 text-xs text-text-tertiary">
                    <Lock01 className="mr-1 h-3 w-3 text-text-tertiary" />
                    {t('modelProvider.encrypted.front', { ns: 'common' })}
                    <a
                      className="mx-1 text-text-accent"
                      target="_blank"
                      rel="noopener noreferrer"
                      href="https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html"
                    >
                      PKCS1_OAEP
                    </a>
                    {t('modelProvider.encrypted.back', { ns: 'common' })}
                  </div>
                </div>
              )
            }
          </div>
          {
            deleteCredentialId && (
              <Confirm
                isShow
                title={t('modelProvider.confirmDelete', { ns: 'common' })}
                isDisabled={doingAction}
                onCancel={closeConfirmDelete}
                onConfirm={handleDeleteCredential}
              />
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ModelModal)
