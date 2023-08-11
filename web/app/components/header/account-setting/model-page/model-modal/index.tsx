import { useCallback, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { Portal } from '@headlessui/react'
import type { FormValue, ProviderConfigModal } from '../declarations'
import { ConfigurableProviders } from '../utils'
import Form from './Form'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { useEventEmitterContextContext } from '@/context/event-emitter'

type ModelModalProps = {
  isShow: boolean
  onCancel: () => void
  modelModal?: ProviderConfigModal
  onSave: (v?: FormValue) => void
  mode: string
}

const ModelModal: FC<ModelModalProps> = ({
  isShow,
  onCancel,
  modelModal,
  onSave,
  mode,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const { eventEmitter } = useEventEmitterContextContext()
  const [value, setValue] = useState<FormValue | undefined>()
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [cleared, setCleared] = useState(false)
  const [prevIsShow, setPrevIsShow] = useState(isShow)
  const [validating, setValidating] = useState(false)

  if (prevIsShow !== isShow) {
    setCleared(false)
    setPrevIsShow(isShow)
  }

  eventEmitter?.useSubscription((v) => {
    if (v === 'provider-save')
      setLoading(true)
    else
      setLoading(false)
  })
  const handleValidatedError = useCallback((newErrorMessage: string) => {
    setErrorMessage(newErrorMessage)
  }, [])
  const handleValidating = useCallback((newValidating: boolean) => {
    setValidating(newValidating)
  }, [])
  const validateRequiredValue = () => {
    const validateValue = value || modelModal?.defaultValue
    if (modelModal) {
      const { fields } = modelModal
      const requiredFields = fields.filter(field => !(typeof field.hidden === 'function' ? field.hidden(validateValue) : field.hidden) && field.required)

      for (let i = 0; i < requiredFields.length; i++) {
        const currentField = requiredFields[i]
        if (!validateValue?.[currentField.key]) {
          setErrorMessage(t('appDebug.errorMessage.valueOfVarRequired', { key: currentField.label[locale] }) || '')
          return false
        }
      }
      return true
    }
  }
  const handleSave = () => {
    if (validateRequiredValue())
      onSave(value || modelModal?.defaultValue)
  }

  const renderTitlePrefix = () => {
    let prefix
    if (mode === 'edit')
      prefix = t('common.operation.edit')
    else
      prefix = ConfigurableProviders.includes(modelModal!.key) ? t('common.operation.create') : t('common.operation.setup')

    return `${prefix} ${modelModal?.title[locale]}`
  }

  if (!isShow)
    return null

  return (
    <Portal>
      <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
        <div className='w-[640px] max-h-screen bg-white shadow-xl rounded-2xl overflow-y-auto'>
          <div className='px-8 pt-8'>
            <div className='flex justify-between items-center mb-2'>
              <div className='text-xl font-semibold text-gray-900'>{renderTitlePrefix()}</div>
              {modelModal?.icon}
            </div>
            <Form
              modelModal={modelModal}
              fields={modelModal?.fields || []}
              initValue={modelModal?.defaultValue}
              onChange={newValue => setValue(newValue)}
              onValidatedError={handleValidatedError}
              mode={mode}
              cleared={cleared}
              onClearedChange={setCleared}
              onValidating={handleValidating}
            />
            <div className='flex justify-between items-center py-6'>
              <a
                href={modelModal?.link.href}
                target='_blank'
                className='inline-flex items-center text-xs text-primary-600'
              >
                {modelModal?.link.label[locale]}
                <LinkExternal02 className='ml-1 w-3 h-3' />
              </a>
              <div>
                <Button className='mr-2 !h-9 !text-sm font-medium text-gray-700' onClick={onCancel}>{t('common.operation.cancel')}</Button>
                <Button
                  className='!h-9 !text-sm font-medium'
                  type='primary'
                  onClick={handleSave}
                  disabled={loading || (mode === 'edit' && !cleared) || validating}
                >
                  {t('common.operation.save')}
                </Button>
              </div>
            </div>
          </div>
          <div className='border-t-[0.5px] border-t-[rgba(0,0,0,0.05)]'>
            {
              errorMessage
                ? (
                  <div className='flex px-[10px] py-3 bg-[#FEF3F2] text-xs text-[#D92D20]'>
                    <AlertCircle className='mt-[1px] mr-2 w-[14px] h-[14px]' />
                    {errorMessage}
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
    </Portal>
  )
}

export default ModelModal
