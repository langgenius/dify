import type { FC } from 'react'
import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CustomConfigurationModelFixedFields,
  ModelProvider,
} from '../declarations'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
} from '../declarations'
import {
  useLanguage,
} from '../hooks'
import Button from '@/app/components/base/button'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import Confirm from '@/app/components/base/confirm'
import { useAppContext } from '@/context/app-context'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import { useModelFormSchemas } from '../model-auth/hooks'
import type {
  Credential,
  CustomModel,
} from '../declarations'
import Loading from '@/app/components/base/loading'
import {
  useAuth,
  useCredentialData,
} from '@/app/components/header/account-setting/model-provider-page/model-auth/hooks'

type ModelModalProps = {
  provider: ModelProvider
  configurateMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  onCancel: () => void
  onSave: () => void
  model?: CustomModel
  credential?: Credential
  isModelCredential?: boolean
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
}) => {
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
  } = useAuth(provider, configurateMethod, currentCustomConfigurationModelFixedFields, isModelCredential, onSave)
  const {
    credentials: formSchemasValue,
  } = credentialData as any

  const { isCurrentWorkspaceManager } = useAppContext()
  const isEditMode = !!formSchemasValue && isCurrentWorkspaceManager
  const { t } = useTranslation()
  const language = useLanguage()
  const {
    formSchemas,
    formValues,
  } = useModelFormSchemas(provider, providerFormSchemaPredefined, formSchemasValue, credential, model)
  const formRef = useRef<FormRefObject>(null)

  const handleSave = useCallback(async () => {
    const {
      isCheckValidated,
      values,
    } = formRef.current?.getFormValues({
      needCheckValidatedValues: true,
      needTransformWhenSecretFieldIsPristine: true,
    }) || { isCheckValidated: false, values: {} }
    if (!isCheckValidated)
      return

    const {
      __authorization_name__,
      __model_name,
      __model_type,
      ...rest
    } = values
    if (__model_name && __model_type) {
      handleSaveCredential({
        credential_id: credential?.credential_id,
        credentials: rest,
        name: __authorization_name__,
        model: __model_name,
        model_type: __model_type,
      })
    }
    else {
      handleSaveCredential({
        credential_id: credential?.credential_id,
        credentials: rest,
        name: __authorization_name__,
      })
    }
  }, [handleSaveCredential, credential?.credential_id, model])

  const renderTitlePrefix = () => {
    const prefix = isEditMode ? t('common.operation.setup') : t('common.operation.add')
    return `${prefix} ${provider.label[language] || provider.label.en_US}`
  }

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent className='z-[60] h-full w-full'>
        <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
          <div className='mx-2 w-[640px] overflow-auto rounded-2xl bg-components-panel-bg shadow-xl'>
            <div className='px-8 pt-8'>
              <div className='mb-2 flex items-center'>
                <div className='text-xl font-semibold text-text-primary'>{renderTitlePrefix()}</div>
              </div>

              <div className='max-h-[calc(100vh-320px)] overflow-y-auto'>
                {
                  isLoading && (
                    <div className='flex items-center justify-center'>
                      <Loading />
                    </div>
                  )
                }
                {
                  !isLoading && (
                    <AuthForm
                      formSchemas={formSchemas.map((formSchema) => {
                        return {
                          ...formSchema,
                          name: formSchema.variable,
                          showRadioUI: formSchema.type === FormTypeEnum.radio,
                        }
                      }) as FormSchema[]}
                      defaultValues={formValues}
                      inputClassName='justify-start'
                      ref={formRef}
                    />
                  )
                }
              </div>

              <div className='sticky bottom-0 -mx-2 mt-2 flex flex-wrap items-center justify-between gap-y-2 bg-components-panel-bg px-2 pb-6 pt-4'>
                {
                  (provider.help && (provider.help.title || provider.help.url))
                    ? (
                      <a
                        href={provider.help?.url[language] || provider.help?.url.en_US}
                        target='_blank' rel='noopener noreferrer'
                        className='inline-flex items-center text-xs text-primary-600'
                        onClick={e => !provider.help.url && e.preventDefault()}
                      >
                        {provider.help.title?.[language] || provider.help.url[language] || provider.help.title?.en_US || provider.help.url.en_US}
                        <LinkExternal02 className='ml-1 h-3 w-3' />
                      </a>
                    )
                    : <div />
                }
                <div>
                  {
                    isEditMode && (
                      <Button
                        variant='warning'
                        size='large'
                        className='mr-2'
                        onClick={() => openConfirmDelete(credential, model)}
                      >
                        {t('common.operation.remove')}
                      </Button>
                    )
                  }
                  <Button
                    size='large'
                    className='mr-2'
                    onClick={onCancel}
                  >
                    {t('common.operation.cancel')}
                  </Button>
                  <Button
                    size='large'
                    variant='primary'
                    onClick={handleSave}
                    disabled={isLoading || doingAction}
                  >
                    {t('common.operation.save')}
                  </Button>
                </div>
              </div>
            </div>
            <div className='border-t-[0.5px] border-t-divider-regular'>
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
            </div>
          </div>
          {
            deleteCredentialId && (
              <Confirm
                isShow
                title={t('common.modelProvider.confirmDelete')}
                isDisabled={doingAction}
                onCancel={closeConfirmDelete}
                onConfirm={handleConfirmDelete}
              />
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ModelModal)
