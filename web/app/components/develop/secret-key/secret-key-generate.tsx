'use client'
import { useTranslation } from 'react-i18next'
import { XMarkIcon } from '@heroicons/react/20/solid'
import InputCopy from './input-copy'
import s from './style.module.css'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import type { CreateApiKeyResponse } from '@/models/app'

type ISecretKeyGenerateModalProps = {
  isShow: boolean
  onClose: () => void
  newKey?: CreateApiKeyResponse
  className?: string
}

const SecretKeyGenerateModal = ({
  isShow = false,
  onClose,
  newKey,
  className,
}: ISecretKeyGenerateModalProps) => {
  const { t } = useTranslation()
  return (
    <Modal isShow={isShow} onClose={onClose} title={`${t('appApi.apiKeyModal.apiSecretKey')}`} className={`px-8 ${className}`}>
      <XMarkIcon className={`absolute h-6 w-6 cursor-pointer text-text-tertiary ${s.close}`} onClick={onClose} />
      <p className='mt-1 text-[13px] font-normal leading-5 text-text-tertiary'>{t('appApi.apiKeyModal.generateTips')}</p>
      <div className='my-4'>
        <InputCopy className='w-full' value={newKey?.token} />
      </div>
      <div className='my-4 flex justify-end'>
        <Button className={`shrink-0 ${s.w64}`} onClick={onClose}>
          <span className='text-xs font-medium text-text-secondary'>{t('appApi.actionMsg.ok')}</span>
        </Button>
      </div>

    </Modal >
  )
}

export default SecretKeyGenerateModal
