import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import OpenaiForm from './OpenaiForm'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'

type ModelModalProps = {
  type?: string
  isShow: boolean
  onCancel: () => void
}

const ModelModal: FC<ModelModalProps> = ({
  type,
  isShow,
  onCancel,
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow={isShow}
      onClose={() => {}}
      className='!p-0 !w-[640px] !max-w-[640px]'
    >
      <div className='px-8 pt-8 pb-6'>
        <div className='flex justify-between items-center mb-7'>
          <div className='text-xl font-semibold text-gray-900'>Setup OpenAI</div>
        </div>
        <div>
          <OpenaiForm />
        </div>
        <div className='flex justify-between items-center'>
          <div></div>
          <div>
            <Button className='mr-2 !h-9 !text-sm font-medium text-gray-700' onClick={onCancel}>{t('common.operation.cancel')}</Button>
            <Button className='!h-9 !text-sm font-medium' type='primary'>{t('common.operation.save')}</Button>
          </div>
        </div>
      </div>
      <div className='flex justify-center items-center h-[42px] bg-gray-50 border-t-[0.5px] border-t-[rgba(0,0,0,0.05)] text-xs text-gray-500'>
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
    </Modal>
  )
}

export default ModelModal
