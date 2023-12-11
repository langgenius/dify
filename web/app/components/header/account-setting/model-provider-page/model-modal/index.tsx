import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type {
  CredentialFormSchema,
  FormValue,
  ModelProvider,
} from '../declarations'
import { ConfigurateMethodEnum } from '../declarations'
import { languageMaps } from '../utils'
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

type ModelModalProps = {
  provider: ModelProvider
  formSchemas: CredentialFormSchema[]
  configurateMethod: ConfigurateMethodEnum
  onCancel: () => void
  onSave: (v: FormValue) => void
}

const ModelModal: FC<ModelModalProps> = ({
  provider,
  formSchemas,
  configurateMethod,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = languageMaps[locale]
  const [loading, setLoading] = useState(false)
  const [initialFormValueCleared, setInitialFormValueCleared] = useState(false)

  const initialFormValue = useMemo(() => {
    return formSchemas.reduce((acc: FormValue, cur) => {
      acc[cur.variable] = cur.default
      return acc
    }, {})
  }, [formSchemas])
  const [value, setValue] = useState(initialFormValue)
  const [validate, validating, validatedStatusState] = useValidate(value)
  const isEditMode = useMemo(() => {
    return formSchemas.every(formSchema => formSchema.required && initialFormValue[formSchema.variable])
  }, [initialFormValue])

  const handleSave = () => {
    onSave(value)

    const validateKeys = formSchemas.filter(formSchema => formSchema.required).map(formSchema => formSchema.variable)
    if (validateKeys.length) {
      validate({
        before: () => {
          for (let i = 0; i < validateKeys.length; i++) {
            if (!value[validateKeys[i]])
              return false
          }
          return true
        },
        run: () => {
          return new Promise((resolve, reject) => {
            setLoading(true)
            setTimeout(() => {
              setLoading(false)
              resolve({})
            }, 1000)
          })
        },
      })
    }
  }

  const renderTitlePrefix = () => {
    let prefix
    if (isEditMode)
      prefix = t('common.operation.edit')
    else
      prefix = configurateMethod === ConfigurateMethodEnum.customizableModel ? t('common.operation.create') : t('common.operation.setup')

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
                <div className='h-6' style={{ background: provider.icon_large[language] }} />
              </div>
              <Form
                value={value}
                onChange={val => setValue(val)}
                formSchemas={formSchemas}
                isEditMode={isEditMode}
                initialFormValueCleared={initialFormValueCleared}
                onInitialFormValueCleared={val => setInitialFormValueCleared(val)}
                validating={validating}
                validatedSuccess={validatedStatusState.status === ValidatedStatus.Success}
              />
              <div className='flex justify-between items-center py-6 flex-wrap gap-y-2'>
                <a
                  href={provider.help_url[language]}
                  target='_blank'
                  className='inline-flex items-center text-xs text-primary-600'
                >
                  {provider.help_text[language]}
                  <LinkExternal02 className='ml-1 w-3 h-3' />
                </a>
                <div>
                  <Button className='mr-2 h-9 text-sm font-medium text-gray-700' onClick={onCancel}>{t('common.operation.cancel')}</Button>
                  <Button
                    className='h-9 text-sm font-medium'
                    type='primary'
                    onClick={handleSave}
                    disabled={loading || (isEditMode && !initialFormValueCleared) || validating}
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
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ModelModal
