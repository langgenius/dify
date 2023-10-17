import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'

type SettingsModalProps = {
  onCancel: () => void
}

const SettingsModal: FC<SettingsModalProps> = ({
  onCancel,
}) => {
  const { t } = useTranslation()
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
      onClose={onCancel}
      className='!p-8 !max-w-none !w-[640px]'
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
                className='flex items-center px-3 py-2 rounded-lg border border-gray-100 bg-gray-25'>
                <div className='mr-2 w-4 h-4 rounded-full border border-gray-300' />
                {provider.name}
              </div>
            ))
          }
        </div>
      </div>
      <div className='py-2'>
        <div className='mb-1 text-sm font-medium text-gray-900'>{t('appDebug.feature.moderation.modal.provider.keywords')}</div>
        <div className='mb-2 text-xs text-gray-500'>{t('appDebug.feature.moderation.modal.keywords.tip')}</div>
        <div className='px-3 py-2 h-[88px] bg-gray-100 rounded-lg'>
          <textarea placeholder={t('appDebug.feature.moderation.modal.keywords.placeholder') || ''} />
        </div>
      </div>
      <div className='py-2'>
        <div className='flex items-center justify-between h-9'>
          <div className='text-sm font-medium text-gray-900'>{t('appDebug.feature.moderation.modal.apiEndpoint.title')}</div>
          <a
            href={'/'}
            className='flex items-center text-xs text-gray-500'
          >
            <BookOpen01 className='mr-1 w-3 h-3 text-gray-500' />
            {t('appDebug.feature.moderation.modal.apiEndpoint.link')}
          </a>
        </div>
        <input className='px-3 py-2 h-9 bg-gray-100 rounded-lg' />
      </div>
      <div className='py-2'>
        <div className='leading-9 text-sm font-medium text-gray-900'>
          {t('appDebug.feature.moderation.modal.apiKey.title')}
        </div>
        <div className='flex items-center'>
          <input className='grow mr-2 rounded-lg bg-gray-100' />
          <Button>{t('appDebug.feature.moderation.modal.apiKey.regenerate')}</Button>
        </div>
      </div>
      <div className='h-[1px] bg-gray-200'></div>
      <div className='my-2 rounded-lg border border-gray-200'>
        <div>{t('appDebug.feature.moderation.modal.input.title')}</div>
        <div>
          <div>{t('appDebug.feature.moderation.modal.input.preset')}</div>
          <div>
            <textarea placeholder={t('appDebug.feature.moderation.modal.input.placeholder') || ''} />
          </div>
        </div>
      </div>
      <div className='py-2'>
        <div>{t('appDebug.feature.moderation.modal.output.title')}</div>
      </div>
      <div>{t('appDebug.feature.moderation.modal.condition')}</div>
      <div>
        <Button>{t('common.operation.cancel')}</Button>
        <Button>{t('common.operation.save')}</Button>
      </div>
    </Modal>
  )
}

export default SettingsModal
