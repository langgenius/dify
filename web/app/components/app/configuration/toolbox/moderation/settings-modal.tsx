import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ApiBasedExtensionSelector from '@/app/components/header/account-setting/api-based-extension-page/selector'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Switch from '@/app/components/base/switch'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'

type SettingsModalProps = {
  onCancel: () => void
}

const SettingsModal: FC<SettingsModalProps> = ({
  onCancel,
}) => {
  const { t } = useTranslation()
  const [activeProviderKey, setActiveProviderKey] = useState('keywords')
  const providers = [
    {
      key: 'openai',
      name: t('appDebug.feature.moderation.modal.provider.openai'),
    },
    {
      key: 'keywords',
      name: t('appDebug.feature.moderation.modal.provider.keywords'),
    },
    {
      key: 'custom',
      name: t('appDebug.feature.moderation.modal.provider.custom'),
    },
  ]

  return (
    <Modal
      isShow
      onClose={() => {}}
      className='!p-8 !pb-6 !max-w-none !w-[640px]'
    >
      <div className='mb-2 text-xl font-semibold text-[#1D2939]'>
        {t('appDebug.feature.moderation.modal.title')}
      </div>
      <div className='py-2'>
        <div className='leading-9 text-sm font-medium text-gray-900'>
          {t('appDebug.feature.moderation.modal.provider.title')}
        </div>
        <div className='grid gap-3 grid-cols-3'>
          {
            providers.map(provider => (
              <div
                key={provider.key}
                className={`
                  flex items-center px-3 py-2 rounded-lg text-sm text-gray-900 cursor-pointer
                  ${activeProviderKey === provider.key ? 'bg-white border-[1.5px] border-primary-400 shadow-sm' : 'border border-gray-100 bg-gray-25'}
                `}
                onClick={() => setActiveProviderKey(provider.key)}
              >
                <div className={`
                  mr-2 w-4 h-4 rounded-full border 
                  ${activeProviderKey === provider.key ? 'border-[5px] border-primary-600' : 'border border-gray-300'}`} />
                {provider.name}
              </div>
            ))
          }
        </div>
      </div>
      {
        activeProviderKey === 'keywords' && (
          <div className='py-2'>
            <div className='mb-1 text-sm font-medium text-gray-900'>{t('appDebug.feature.moderation.modal.provider.keywords')}</div>
            <div className='mb-2 text-xs text-gray-500'>{t('appDebug.feature.moderation.modal.keywords.tip')}</div>
            <div className='px-3 py-2 h-[88px] bg-gray-100 rounded-lg'>
              <textarea
                className='block w-full h-full bg-transparent text-sm outline-none appearance-none resize-none'
                placeholder={t('appDebug.feature.moderation.modal.keywords.placeholder') || ''}
              />
            </div>
          </div>
        )
      }
      {
        activeProviderKey === 'custom' && (
          <div className='py-2'>
            <div className='flex items-center justify-between h-9'>
              <div className='text-sm font-medium text-gray-900'>{t('common.apiBasedExtension.selector.title')}</div>
              <a
                href={'/'}
                className='flex items-center text-xs text-gray-500'
              >
                <BookOpen01 className='mr-1 w-3 h-3 text-gray-500' />
                {t('common.apiBasedExtension.link')}
              </a>
            </div>
            <ApiBasedExtensionSelector />
          </div>
        )
      }
      <div className='my-3 h-[1px] bg-gradient-to-r from-[#F3F4F6]'></div>
      <div className='py-2'>
        <div className='rounded-lg bg-gray-50 border border-gray-200'>
          <div className='flex items-center justify-between px-3 h-10 text-sm font-medium text-gray-900 rounded-lg'>
            {t('appDebug.feature.moderation.modal.input.title')}
            <Switch
              size='l'
              onChange={() => {}}
            />
          </div>
          {
            activeProviderKey !== 'custom' && (
              <div className='px-3 pt-1 pb-3 bg-white rounded-lg'>
                <div className='leading-8 text-[13px] font-medium text-gray-700'>{t('appDebug.feature.moderation.modal.input.preset')}</div>
                <div className='relative px-3 py-2 h-20 rounded-lg bg-gray-100'>
                  <textarea
                    className='block w-full h-full bg-transparent text-sm outline-none appearance-none resize-none'
                    placeholder={t('appDebug.feature.moderation.modal.input.placeholder') || ''}
                  />
                </div>
              </div>
            )
          }
        </div>
      </div>
      <div className='py-2'>
        <div className='rounded-lg bg-gray-50 border border-gray-200'>
          <div className='flex items-center justify-between px-3 h-10 text-sm font-medium text-gray-900 rounded-lg'>
            {t('appDebug.feature.moderation.modal.output.title')}
            <Switch
              size='l'
              onChange={() => {}}
            />
          </div>
        </div>
      </div>
      <div className='mt-1 mb-8 text-xs font-medium text-gray-500'>{t('appDebug.feature.moderation.modal.condition')}</div>
      <div className='flex items-center justify-end'>
        <Button
          onClick={onCancel}
          className='mr-2 text-sm font-medium'
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          type='primary'
          className='text-sm font-medium'
          onClick={() => {}}
        >
          {t('common.operation.save')}
        </Button>
      </div>
    </Modal>
  )
}

export default SettingsModal
