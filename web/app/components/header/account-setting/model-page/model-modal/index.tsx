import { useCallback, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { FormValue, ProviderConfigModal } from '../declarations'
import Form from './Form'
import I18n from '@/context/i18n'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'

type ModelModalProps = {
  isShow: boolean
  onCancel: () => void
  modelModal?: ProviderConfigModal
  onSave: (v?: FormValue) => void
}

const ModelModal: FC<ModelModalProps> = ({
  isShow,
  onCancel,
  modelModal,
  onSave,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const [value, setValue] = useState<FormValue>()
  const [errorMessage, setErrorMessage] = useState('')

  const handleValidatedError = useCallback((newErrorMessage: string) => {
    setErrorMessage(newErrorMessage)
  }, [])

  return (
    <Modal
      isShow={isShow}
      onClose={() => {}}
      className='!p-0 !w-[640px] !max-w-[640px]'
    >
      <div className='px-8 pt-8'>
        <div className='flex justify-between items-center mb-2'>
          <div className='text-xl font-semibold text-gray-900'>{modelModal?.title[locale]}</div>
          {modelModal?.icon}
        </div>
        <Form
          modelModal={modelModal}
          fields={modelModal?.fields || []}
          initValue={modelModal?.defaultValue}
          onChange={newValue => setValue(newValue)}
          onValidatedError={handleValidatedError}
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
              onClick={() => onSave(value)}
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
    </Modal>
  )
}

export default ModelModal
