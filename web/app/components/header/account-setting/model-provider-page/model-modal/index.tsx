import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type {
  CredentialFormSchema,
  FormValue,
  ModelProvider,
} from '../declarations'
import {
  ConfigurateMethodEnum,
  FormTypeEnum,
} from '../declarations'
import {
  languageMaps,
  removeCredentials,
  saveCredentials,
  validateCredentials,
} from '../utils'
import { useValidate } from '../../key-validator/hooks'
import { ValidatedStatus } from '../../key-validator/declarations'
import Form from './Form'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { fetchModelProviderCredentials } from '@/service/common'
import Loading from '@/app/components/base/loading'
import { useToastContext } from '@/app/components/base/toast'
import ConfirmCommon from '@/app/components/base/confirm/common'

type ModelModalProps = {
  provider: ModelProvider
  configurateMethod: ConfigurateMethodEnum
  onCancel: () => void
  onSave: () => void
}

const ModelModal: FC<ModelModalProps> = ({
  provider,
  configurateMethod,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { locale } = useContext(I18n)
  const language = languageMaps[locale]
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const { data: formSchemasValue, isLoading } = useSWR(`/workspaces/current/model-providers/${provider.provider}/credentials`, fetchModelProviderCredentials)
  const initialFormSchemasValue = useMemo(() => {
    return formSchemasValue?.credentials || {}
  }, [formSchemasValue])
  const [value, setValue] = useState(initialFormSchemasValue)
  useEffect(() => {
    setValue(initialFormSchemasValue)
  }, [initialFormSchemasValue])
  const [validate, validating, validatedStatusState] = useValidate(value)
  const isEditMode = !!formSchemasValue?.credentials
  const formSchemas = provider.provider_credential_schema.credential_form_schemas
  const providerFormSchemaPredefined = configurateMethod === ConfigurateMethodEnum.predefinedModel
  const [requiredFormSchemas, secretFormSchemas] = useMemo(() => {
    const requiredFormSchemas: CredentialFormSchema[] = []
    const secretFormSchemas: CredentialFormSchema[] = []

    formSchemas.forEach((formSchema) => {
      if (formSchema.required)
        requiredFormSchemas.push(formSchema)

      if (formSchema.type === FormTypeEnum.secretInput)
        secretFormSchemas.push(formSchema)
    })

    return [requiredFormSchemas, secretFormSchemas]
  }, [formSchemas])
  const formRequiredValueAllCompleted = requiredFormSchemas.every(formSchema => value[formSchema.variable])

  const handleValueChange = (v: FormValue) => {
    setValue(v)

    if (requiredFormSchemas.length) {
      validate({
        before: () => {
          for (let i = 0; i < requiredFormSchemas.length; i++) {
            if (!v[requiredFormSchemas[i].variable])
              return false
          }
          return true
        },
        run: () => {
          return validateCredentials(
            providerFormSchemaPredefined,
            provider.provider,
            {
              credentials: v,
            },
          )
        },
      })
    }
  }
  const handleSave = async () => {
    try {
      setLoading(true)
      const secretValues = secretFormSchemas.reduce((prev, next) => {
        if (value[next.variable] === initialFormSchemasValue[next.variable])
          prev[next.variable] = '[__HIDDEN__]'

        return prev
      }, {} as Record<string, string>)

      const res = await saveCredentials(
        providerFormSchemaPredefined,
        provider.provider,
        {
          credentials: {
            ...value,
            ...secretValues,
          },
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
        {
          isLoading && (
            <Loading />
          )
        }
        {
          !isLoading && (
            <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
              <div className='mx-2 w-[640px] max-h-[calc(100vh-120px)] bg-white shadow-xl rounded-2xl overflow-y-auto'>
                <div className='px-8 pt-8'>
                  <div className='flex justify-between items-center mb-2'>
                    <div className='text-xl font-semibold text-gray-900'>{renderTitlePrefix()}</div>
                    <div className='h-6' style={{ background: provider.icon_large[language] }} />
                  </div>
                  <Form
                    value={value}
                    onChange={handleValueChange}
                    formSchemas={formSchemas}
                    validating={validating}
                    validatedSuccess={validatedStatusState.status === ValidatedStatus.Success}
                  />
                  <div className='flex justify-between items-center py-6 flex-wrap gap-y-2'>
                    {
                      (provider.help && (provider.help.title || provider.help.url))
                        ? (
                          <a
                            href={provider.help?.url[language]}
                            target='_blank'
                            className='inline-flex items-center text-xs text-primary-600'
                            onClick={e => !provider.help.url && e.preventDefault()}
                          >
                            {provider.help.title?.[language] || provider.help.url[language]}
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
                        disabled={loading || validating || !formRequiredValueAllCompleted}
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
                            target={'_blank'}
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
                    title='Are you sure?'
                    isShow={showConfirm}
                    onCancel={() => setShowConfirm(false)}
                    onConfirm={handleRemove}
                    confirmWrapperClassName='z-[70]'
                  />
                )
              }
            </div>
          )
        }
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ModelModal
