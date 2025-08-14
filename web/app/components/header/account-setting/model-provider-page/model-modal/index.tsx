import type { FC } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CustomConfigurationModelFixedFields,
  ModelLoadBalancingConfig,
  ModelLoadBalancingConfigEntry,
  ModelProvider,
} from '../declarations'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  FormTypeEnum,
} from '../declarations'
import {
  genModelNameFormSchema,
  genModelTypeFormSchema,
  removeCredentials,
  saveCredentials,
} from '../utils'
import {
  useLanguage,
  useProviderCredentialsAndLoadBalancing,
} from '../hooks'
import ModelLoadBalancingConfigs from '../provider-added-card/model-load-balancing-configs'
import Button from '@/app/components/base/button'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { useToastContext } from '@/app/components/base/toast'
import Confirm from '@/app/components/base/confirm'
import { useAppContext } from '@/context/app-context'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import type {
  FormRefObject,
  FormSchema,
} from '@/app/components/base/form/types'
import { useModelFormSchemas } from '../model-auth/hooks'
import type { Credential } from '../declarations'
import Loading from '@/app/components/base/loading'

type ModelModalProps = {
  provider: ModelProvider
  configurateMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  credential?: Credential
  onCancel: () => void
  onSave: () => void
}

const ModelModal: FC<ModelModalProps> = ({
  provider,
  configurateMethod,
  currentCustomConfigurationModelFixedFields,
  credential,
  onCancel,
  onSave,
}) => {
  const providerFormSchemaPredefined = configurateMethod === ConfigurationMethodEnum.predefinedModel
  const {
    credentials: formSchemasValue,
    loadBalancing: originalConfig,
    mutate,
    isLoading,
  } = useProviderCredentialsAndLoadBalancing(
    provider.provider,
    configurateMethod,
    providerFormSchemaPredefined && provider.custom_configuration.status === CustomConfigurationStatusEnum.active,
    currentCustomConfigurationModelFixedFields,
    credential?.credential_id,
  )
  const { isCurrentWorkspaceManager } = useAppContext()
  const isEditMode = !!formSchemasValue && isCurrentWorkspaceManager
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const language = useLanguage()
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [draftConfig, setDraftConfig] = useState<ModelLoadBalancingConfig>()
  const originalConfigMap = useMemo(() => {
    if (!originalConfig)
      return {}
    return originalConfig?.configs.reduce((prev, config) => {
      if (config.id)
        prev[config.id] = config
      return prev
    }, {} as Record<string, ModelLoadBalancingConfigEntry>)
  }, [originalConfig])
  useEffect(() => {
    if (originalConfig && !draftConfig)
      setDraftConfig(originalConfig)
  }, [draftConfig, originalConfig])

  const { formSchemas } = useModelFormSchemas(provider, providerFormSchemaPredefined, draftConfig)
  const formRef = useRef<FormRefObject>(null)

  const extendedSecretFormSchemas = useMemo(
    () =>
      (providerFormSchemaPredefined
        ? provider.provider_credential_schema.credential_form_schemas
        : [
          genModelTypeFormSchema(provider.supported_model_types),
          genModelNameFormSchema(provider.model_credential_schema?.model),
          ...provider.model_credential_schema.credential_form_schemas,
        ]).filter(({ type }) => type === FormTypeEnum.secretInput),
    [
      provider.model_credential_schema?.credential_form_schemas,
      provider.model_credential_schema?.model,
      provider.provider_credential_schema?.credential_form_schemas,
      provider.supported_model_types,
      providerFormSchemaPredefined,
    ],
  )

  const encodeConfigEntrySecretValues = useCallback((entry: ModelLoadBalancingConfigEntry) => {
    const result = { ...entry }
    extendedSecretFormSchemas.forEach(({ variable }) => {
      if (entry.id && result.credentials[variable] === originalConfigMap[entry.id]?.credentials?.[variable])
        result.credentials[variable] = '[__HIDDEN__]'
    })
    return result
  }, [extendedSecretFormSchemas, originalConfigMap])

  const handleSave = async () => {
    try {
      setLoading(true)
      const {
        isCheckValidated,
        values,
      } = formRef.current?.getFormValues({
        needCheckValidatedValues: true,
        needTransformWhenSecretFieldIsPristine: true,
      }) || { isCheckValidated: false, values: {} }
      if (!isCheckValidated)
        return

      const res = await saveCredentials(
        providerFormSchemaPredefined,
        provider.provider,
        values,
        {
          ...draftConfig,
          enabled: Boolean(draftConfig?.enabled),
          configs: draftConfig?.configs.map(encodeConfigEntrySecretValues) || [],
        },
      )
      if (res.result === 'success') {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        mutate()
        onSave()
        onCancel()
      }
    }
    finally {
      setLoading(false)
    }
  }

  const handleRemove = async () => {
    try {
      setLoading(true)
      const {
        isCheckValidated,
        values,
      } = formRef.current?.getFormValues({
        needCheckValidatedValues: true,
        needTransformWhenSecretFieldIsPristine: true,
      }) || { isCheckValidated: false, values: {} }
      if (!isCheckValidated)
        return
      const res = await removeCredentials(
        providerFormSchemaPredefined,
        provider.provider,
        values,
        credential?.credential_id,
      )
      if (res.result === 'success') {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        // mutate()
        onSave()
        onCancel()
      }
    }
    finally {
      setLoading(false)
    }
  }

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
                      defaultValues={{
                        ...formSchemasValue,
                        __authorization_name__: credential?.credential_name,
                      }}
                      inputClassName='justify-start'
                      ref={formRef}
                    />
                  )
                }
                {
                  !!draftConfig && (
                    <>
                      <div className='mb-4 mt-1 border-t-[0.5px] border-t-divider-regular' />
                      <ModelLoadBalancingConfigs withSwitch {...{
                        draftConfig,
                        setDraftConfig,
                        provider,
                        currentCustomConfigurationModelFixedFields,
                        configurationMethod: configurateMethod,
                      }} />
                    </>
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
                        onClick={() => setShowConfirm(true)}
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
                    disabled={
                      loading
                      || (draftConfig?.enabled && (draftConfig?.configs.filter(config => config.enabled).length ?? 0) < 2)
                    }

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
            showConfirm && (
              <Confirm
                title={t('common.modelProvider.confirmDelete')}
                isShow={showConfirm}
                onCancel={() => setShowConfirm(false)}
                onConfirm={handleRemove}
              />
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ModelModal)
