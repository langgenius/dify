import type { FC } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiErrorWarningFill,
} from '@remixicon/react'
import type {
  CredentialFormSchema,
  CredentialFormSchemaRadio,
  CredentialFormSchemaSelect,
  CustomConfigurationModelFixedFields,
  FormValue,
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
import { useValidate } from '../../key-validator/hooks'
import { ValidatedStatus } from '../../key-validator/declarations'
import ModelLoadBalancingConfigs from '../provider-added-card/model-load-balancing-configs'
import Form from './Form'
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

type ModelModalProps = {
  provider: ModelProvider
  configurateMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  onCancel: () => void
  onSave: () => void
}

const ModelModal: FC<ModelModalProps> = ({
  provider,
  configurateMethod,
  currentCustomConfigurationModelFixedFields,
  onCancel,
  onSave,
}) => {
  const providerFormSchemaPredefined = configurateMethod === ConfigurationMethodEnum.predefinedModel
  const {
    credentials: formSchemasValue,
    loadBalancing: originalConfig,
    mutate,
  } = useProviderCredentialsAndLoadBalancing(
    provider.provider,
    configurateMethod,
    providerFormSchemaPredefined && provider.custom_configuration.status === CustomConfigurationStatusEnum.active,
    currentCustomConfigurationModelFixedFields,
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

  const formSchemas = useMemo(() => {
    return providerFormSchemaPredefined
      ? provider.provider_credential_schema.credential_form_schemas
      : [
        genModelTypeFormSchema(provider.supported_model_types),
        genModelNameFormSchema(provider.model_credential_schema?.model),
        ...(draftConfig?.enabled ? [] : provider.model_credential_schema.credential_form_schemas),
      ]
  }, [
    providerFormSchemaPredefined,
    provider.provider_credential_schema?.credential_form_schemas,
    provider.supported_model_types,
    provider.model_credential_schema?.credential_form_schemas,
    provider.model_credential_schema?.model,
    draftConfig?.enabled,
  ])
  const [
    requiredFormSchemas,
    defaultFormSchemaValue,
    showOnVariableMap,
  ] = useMemo(() => {
    const requiredFormSchemas: CredentialFormSchema[] = []
    const defaultFormSchemaValue: Record<string, string | number> = {}
    const showOnVariableMap: Record<string, string[]> = {}

    formSchemas.forEach((formSchema) => {
      if (formSchema.required)
        requiredFormSchemas.push(formSchema)

      if (formSchema.default)
        defaultFormSchemaValue[formSchema.variable] = formSchema.default

      if (formSchema.show_on.length) {
        formSchema.show_on.forEach((showOnItem) => {
          if (!showOnVariableMap[showOnItem.variable])
            showOnVariableMap[showOnItem.variable] = []

          if (!showOnVariableMap[showOnItem.variable].includes(formSchema.variable))
            showOnVariableMap[showOnItem.variable].push(formSchema.variable)
        })
      }

      if (formSchema.type === FormTypeEnum.select || formSchema.type === FormTypeEnum.radio) {
        (formSchema as (CredentialFormSchemaRadio | CredentialFormSchemaSelect)).options.forEach((option) => {
          if (option.show_on.length) {
            option.show_on.forEach((showOnItem) => {
              if (!showOnVariableMap[showOnItem.variable])
                showOnVariableMap[showOnItem.variable] = []

              if (!showOnVariableMap[showOnItem.variable].includes(formSchema.variable))
                showOnVariableMap[showOnItem.variable].push(formSchema.variable)
            })
          }
        })
      }
    })

    return [
      requiredFormSchemas,
      defaultFormSchemaValue,
      showOnVariableMap,
    ]
  }, [formSchemas])
  const initialFormSchemasValue: Record<string, string | number> = useMemo(() => {
    return {
      ...defaultFormSchemaValue,
      ...formSchemasValue,
    } as unknown as Record<string, string | number>
  }, [formSchemasValue, defaultFormSchemaValue])
  const [value, setValue] = useState(initialFormSchemasValue)
  useEffect(() => {
    setValue(initialFormSchemasValue)
  }, [initialFormSchemasValue])
  const [_, validating, validatedStatusState] = useValidate(value)
  const filteredRequiredFormSchemas = requiredFormSchemas.filter((requiredFormSchema) => {
    if (requiredFormSchema.show_on.length && requiredFormSchema.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
      return true

    if (!requiredFormSchema.show_on.length)
      return true

    return false
  })

  const handleValueChange = (v: FormValue) => {
    setValue(v)
  }

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

  const encodeSecretValues = useCallback((v: FormValue) => {
    const result = { ...v }
    extendedSecretFormSchemas.forEach(({ variable }) => {
      if (result[variable] === formSchemasValue?.[variable] && result[variable] !== undefined)
        result[variable] = '[__HIDDEN__]'
    })
    return result
  }, [extendedSecretFormSchemas, formSchemasValue])

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
      const res = await saveCredentials(
        providerFormSchemaPredefined,
        provider.provider,
        encodeSecretValues(value),
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

      const res = await removeCredentials(
        providerFormSchemaPredefined,
        provider.provider,
        value,
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

  const renderTitlePrefix = () => {
    const prefix = configurateMethod === ConfigurationMethodEnum.customizableModel ? t('common.operation.add') : t('common.operation.setup')

    return `${prefix} ${provider.label[language] || provider.label.en_US}`
  }

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent className='z-[60] h-full w-full'>
        <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
          <div className='bg-components-panel-bg mx-2 max-h-[calc(100vh-120px)] w-[640px] overflow-y-auto rounded-2xl shadow-xl'>
            <div className='px-8 pt-8'>
              <div className='mb-2 flex items-center'>
                <div className='text-text-primary text-xl font-semibold'>{renderTitlePrefix()}</div>
              </div>

              <Form
                value={value}
                onChange={handleValueChange}
                formSchemas={formSchemas}
                validating={validating}
                validatedSuccess={validatedStatusState.status === ValidatedStatus.Success}
                showOnVariableMap={showOnVariableMap}
                isEditMode={isEditMode}
              />

              <div className='border-t-divider-regular mb-4 mt-1 border-t-[0.5px]' />
              <ModelLoadBalancingConfigs withSwitch {...{
                draftConfig,
                setDraftConfig,
                provider,
                currentCustomConfigurationModelFixedFields,
                configurationMethod: configurateMethod,
              }} />

              <div className='bg-components-panel-bg sticky bottom-0 -mx-2 mt-2 flex flex-wrap items-center justify-between gap-y-2 px-2 pb-6 pt-4'>
                {
                  (provider.help && (provider.help.title || provider.help.url))
                    ? (
                      <a
                        href={provider.help?.url[language] || provider.help?.url.en_US}
                        target='_blank' rel='noopener noreferrer'
                        className='text-primary-600 inline-flex items-center text-xs'
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
                      || filteredRequiredFormSchemas.some(item => value[item.variable] === undefined)
                      || (draftConfig?.enabled && (draftConfig?.configs.filter(config => config.enabled).length ?? 0) < 2)
                    }

                  >
                    {t('common.operation.save')}
                  </Button>
                </div>
              </div>
            </div>
            <div className='border-t-divider-regular border-t-[0.5px]'>
              {
                (validatedStatusState.status === ValidatedStatus.Error && validatedStatusState.message)
                  ? (
                    <div className='bg-background-section-burn flex px-[10px] py-3 text-xs text-[#D92D20]'>
                      <RiErrorWarningFill className='mr-2 mt-[1px] h-[14px] w-[14px]' />
                      {validatedStatusState.message}
                    </div>
                  )
                  : (
                    <div className='bg-background-section-burn text-text-tertiary flex items-center justify-center py-3 text-xs'>
                      <Lock01 className='text-text-tertiary mr-1 h-3 w-3' />
                      {t('common.modelProvider.encrypted.front')}
                      <a
                        className='text-text-accent mx-1'
                        target='_blank' rel='noopener noreferrer'
                        href='https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html'
                      >
                        PKCS1_OAEP
                      </a>
                      {t('common.modelProvider.encrypted.back')}
                    </div>
                  )
              }
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
