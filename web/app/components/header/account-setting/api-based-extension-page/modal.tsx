import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'

export type ApiBasedExtensionData = {
  name?: string
  apiEndpoint?: string
  apiKey?: string
}

type ApiBasedExtensionModalProps = {
  data: ApiBasedExtensionData
  onCancel: () => void
}
const ApiBasedExtensionModal: FC<ApiBasedExtensionModalProps> = ({
  data,
  onCancel,
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow
      onClose={() => {}}
      wrapperClassName='!z-30'
      className='!p-8 !pb-6 !max-w-none !w-[640px]'
    >
      <div className='mb-2 text-xl font-semibold text-gray-900'>
        {
          data.name
            ? t('common.apiBasedExtension.modal.editTitle')
            : t('common.apiBasedExtension.modal.title')
        }
      </div>
      <div className='py-2'>
        <div className='leading-9 text-sm font-medium text-gray-900'>
          {t('common.apiBasedExtension.modal.name.title')}
        </div>
        <input
          value={data.name}
          className='block px-3 w-full h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
          placeholder={t('common.apiBasedExtension.modal.name.placeholder') || ''}
        />
      </div>
      <div className='py-2'>
        <div className='flex justify-between items-center text-sm font-medium text-gray-900'>
          {t('common.apiBasedExtension.modal.apiEndpoint.title')}
          <a
            href={'/'}
            className='flex items-center text-xs text-gray-500'
          >
            <BookOpen01 className='mr-1 w-3 h-3 text-gray-500' />
            {t('common.apiBasedExtension.link')}
          </a>
        </div>
        <input
          value={data.apiEndpoint}
          className='block px-3 w-full h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
          placeholder={t('common.apiBasedExtension.modal.apiEndpoint.placeholder') || ''}
        />
      </div>
      <div className='py-2'>
        <div className='leading-9 text-sm font-medium text-gray-900'>
          {t('common.apiBasedExtension.modal.apiKey.title')}
        </div>
        <div className='flex items-center'>
          <input
            value={data.apiKey}
            className='block grow mr-2 px-3 h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
            placeholder={t('common.apiBasedExtension.modal.apiKey.placeholder') || ''}
          />
          <Button
            className='text-sm font-medium'
          >
            {t('common.apiBasedExtension.modal.apiKey.regenerate')}
          </Button>
        </div>
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

export default ApiBasedExtensionModal
