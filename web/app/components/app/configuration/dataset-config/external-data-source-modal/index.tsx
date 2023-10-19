import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'

type ExternalDataSourceModalProps = {
  onCancel: () => {}
}
const ExternalDataSourceModal: FC<ExternalDataSourceModalProps> = ({
  onCancel,
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow
      onClose={() => {}}
      className='!p-8 !pb-6 !max-w-none !w-[640px]'
    >
      <div className='mb-2 text-xl font-semibold text-gray-900'>
        {t('appDebug.feature.dataSet.modal.title')}
      </div>
      <div className='py-2'>
        <div className='leading-9 text-sm font-medium text-gray-900'>
          {t('appDebug.feature.dataSet.modal.name.title')}
        </div>
        <input
          className='block px-3 h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
          placeholder={t('appDebug.feature.dataSet.modal.name.placeholder') || ''}
        />
      </div>
      <div className='py-2'>
        <div className='flex justify-between items-center text-sm font-medium text-gray-900'>
          {t('appDebug.feature.dataSet.modal.description.title')}
          <a
            href={'/'}
            className='flex items-center text-xs text-gray-500'
          >
            <BookOpen01 className='mr-1 w-3 h-3 text-gray-500' />
            {t('appDebug.feature.dataSet.modal.description.link')}
          </a>
        </div>
        <textarea
          className='block px-3 py-2 h-[88px] rounded-lg bg-gray-100 text-sm outline-none appearance-none'
          placeholder={t('appDebug.feature.dataSet.modal.description.placeholder') || ''}
        />
      </div>
      <div className='py-2'>
        <div className='flex justify-between items-center text-sm font-medium text-gray-900'>
          {t('appDebug.feature.dataSet.modal.apiEndpoint.title')}
          <a
            href={'/'}
            className='flex items-center text-xs text-gray-500'
          >
            <BookOpen01 className='mr-1 w-3 h-3 text-gray-500' />
            {t('appDebug.feature.dataSet.modal.apiEndpoint.link')}
          </a>
        </div>
        <input
          className='block px-3 h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
          placeholder={t('appDebug.feature.dataSet.modal.apiEndpoint.placeholder') || ''}
        />
      </div>
      <div className='py-2'>
        <div className='leading-9 text-sm font-medium text-gray-900'>
          {t('appDebug.feature.dataSet.modal.apiKey.title')}
        </div>
        <input
          className='block px-3 h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
          placeholder={t('appDebug.feature.dataSet.modal.apiKey.placeholder') || ''}
        />
      </div>
      <div className='flex items-center justify-end mt-6'>
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

export default ExternalDataSourceModal
