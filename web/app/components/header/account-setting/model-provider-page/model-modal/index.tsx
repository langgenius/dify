import type { FC } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CredentialFormSchema,
  CredentialFormSchemaRadio,
  CredentialFormSchemaSelect,
  CustomConfigrationModelFixedFields,
  FormValue,
  ModelProvider,
} from '../declarations'
import {
  ConfigurateMethodEnum,
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
  useProviderCrenditialsFormSchemasValue,
} from '../hooks'
import ProviderIcon from '../provider-icon'
import { useValidate } from '../../key-validator/hooks'
import { ValidatedStatus } from '../../key-validator/declarations'
import Form from './Form'
import Button from '@/app/components/base/button'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { useToastContext } from '@/app/components/base/toast'
import ConfirmCommon from '@/app/components/base/confirm/common'

type ModelModalProps = {
  provider: ModelProvider
  configurateMethod: ConfigurateMethodEnum
  currentCustomConfigrationModelFixedFields?: CustomConfigrationModelFixedFields
  onCancel: () => void
  onSave: () => void
}

const ModelModal: FC<ModelModalProps> = ({
  provider,
  configurateMethod,
  currentCustomConfigrationModelFixedFields,
  onCancel,
  onSave,
}) => {
  const providerFormSchemaPredefined = configurateMethod === ConfigurateMethodEnum.predefinedModel
  const formSchemasValue = useProviderCrenditialsFormSchemasValue(
    provider.provider,
    configurateMethod,
    providerFormSchemaPredefined && provider.custom_configuration.status === CustomConfigurationStatusEnum.active,
    currentCustomConfigrationModelFixedFields,
  )
  const isEditMode = !!formSchemasValue
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const language = useLanguage()
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const formSchemas = useMemo(() => {
    return providerFormSchemaPredefined
      ? provider.provider_credential_schema.credential_form_schemas
      : [
        genModelTypeFormSchema(provider.supported_model_types),
        genModelNameFormSchema(provider.model_credential_schema?.model),
        ...provider.model_credential_schema.credential_form_schemas,
      ]
  }, [
    providerFormSchemaPredefined,
    provider.provider_credential_schema?.credential_form_schemas,
    provider.supported_model_types,
    provider.model_credential_schema?.credential_form_schemas,
    provider.model_credential_schema?.model,
  ])
  const [
    requiredFormSchemas,
    secretFormSchemas,
    defaultFormSchemaValue,
    showOnVariableMap,
  ] = useMemo(() => {
    const requiredFormSchemas: CredentialFormSchema[] = []
    const secretFormSchemas: CredentialFormSchema[] = []
    const defaultFormSchemaValue: Record<string, string | number> = {}
    const showOnVariableMap: Record<string, string[]> = {}

    formSchemas.forEach((formSchema) => {
      if (formSchema.required)
        requiredFormSchemas.push(formSchema)

      if (formSchema.type === FormTypeEnum.secretInput)
        secretFormSchemas.push(formSchema)

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
      secretFormSchemas,
      defaultFormSchemaValue,
      showOnVariableMap,
    ]
  }, [formSchemas])
  const initialFormSchemasValue = useMemo(() => {
    return {
      ...defaultFormSchemaValue,
      ...formSchemasValue,
    }
  }, [formSchemasValue, defaultFormSchemaValue])
  const [value, setValue] = useState(initialFormSchemasValue)
  useEffect(() => {
    setValue(initialFormSchemasValue)
  }, [initialFormSchemasValue])
  const [validate, validating, validatedStatusState] = useValidate(value)
  const filteredRequiredFormSchemas = requiredFormSchemas.filter((requiredFormSchema) => {
    if (requiredFormSchema.show_on.length && requiredFormSchema.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
      return true

    if (!requiredFormSchema.show_on.length)
      return true

    return false
  })
  const getSecretValues = useCallback((v: FormValue) => {
    return secretFormSchemas.reduce((prev, next) => {
      if (v[next.variable] === initialFormSchemasValue[next.variable])
        prev[next.variable] = '[__HIDDEN__]'

      return prev
    }, {} as Record<string, string>)
  }, [initialFormSchemasValue, secretFormSchemas])

  const handleValueChange = (v: FormValue) => {
    setValue(v)
  }
  const handleSave = async () => {
    try {
      setLoading(true)

      const res = await saveCredentials(
        providerFormSchemaPredefined,
        provider.provider,
        {
          ...value,
          ...getSecretValues(value),
        },
      )
      if (res.result === 'success') {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
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
        onSave()
        onCancel()
      }
    }
    finally {
      setLoading(false)
    }
  }

  const renderTitlePrefix = () => {
    const prefix = configurateMethod === ConfigurateMethodEnum.customizableModel ? t('common.operation.add') : t('common.operation.setup')

    return `${prefix} ${provider.label[language]}`
  }

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent className='w-full h-full z-[60]'>
        <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
          <div className='mx-2 w-[640px] max-h-[calc(100vh-120px)] bg-white shadow-xl rounded-2xl overflow-y-auto'>
            <div className='px-8 pt-8'>
              <div className='flex justify-between items-center mb-2'>
                <div className='text-xl font-semibold text-gray-900'>{renderTitlePrefix()}</div>
                <ProviderIcon provider={provider} />
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
              <div className='sticky bottom-0 flex justify-between items-center py-6 flex-wrap gap-y-2 bg-white'>
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
                        <LinkExternal02 className='ml-1 w-3 h-3' />
                      </a>
                    )
                    : <div />
                }
                <div>
                  {
                    isEditMode && (
                      <Button
                        className='mr-2 h-9 text-sm font-medium text-[#D92D20]'
                        onClick={() => setShowConfirm(true)}
                      >
                        {t('common.operation.remove')}
                      </Button>
                    )
                  }
                  <Button
                    className='mr-2 h-9 text-sm font-medium text-gray-700'
                    onClick={onCancel}
                  >
                    {t('common.operation.cancel')}
                  </Button>
                  <Button
                    className='h-9 text-sm font-medium'
                    type='primary'
                    onClick={handleSave}
                    disabled={loading || filteredRequiredFormSchemas.some(item => value[item.variable] === undefined)}
                  >
                    {t('common.operation.save')}
                  </Button>
                </div>
              </div>
            </div>
            <div className='border-t-[0.5px] border-t-black/5'>
              {
                (validatedStatusState.status === ValidatedStatus.Error && validatedStatusState.message)
                  ? (
                    <div className='flex px-[10px] py-3 bg-[#FEF3F2] text-xs text-[#D92D20]'>
                      <AlertCircle className='mt-[1px] mr-2 w-[14px] h-[14px]' />
                      {validatedStatusState.message}
                    </div>
                  )
                  : (
                    <div className='flex justify-center items-center py-3 bg-gray-50 text-xs text-gray-500'>
                      <Lock01 className='mr-1 w-3 h-3 text-gray-500' />
                      {t('common.modelProvider.encrypted.front')}
                      <a
                        className='text-primary-600 mx-1'
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
              <ConfirmCommon
                title={t('common.modelProvider.confirmDelete')}
                isShow={showConfirm}
                onCancel={() => setShowConfirm(false)}
                onConfirm={handleRemove}
                confirmWrapperClassName='z-[70]'
              />
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ModelModal)
