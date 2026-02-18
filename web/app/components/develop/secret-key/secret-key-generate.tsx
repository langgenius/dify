'use client'
import type { CreateApiKeyResponse } from '@/models/app'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import InputCopy from './input-copy'
import s from './style.module.css'

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
    <Modal isShow={isShow} onClose={onClose} title={`${t('apiKeyModal.apiSecretKey', { ns: 'appApi' })}`} className={`px-8 ${className}`}>
      <div className="-mr-2 -mt-6 mb-4 flex justify-end">
        <XMarkIcon className="h-6 w-6 cursor-pointer text-text-tertiary" onClick={onClose} />
      </div>
      <p className="mt-1 text-[13px] font-normal leading-5 text-text-tertiary">{t('apiKeyModal.generateTips', { ns: 'appApi' })}</p>
      <div className="my-4">
        <InputCopy className="w-full" value={newKey?.token} />
      </div>
      <div className="my-4 flex justify-end">
        <Button className={`shrink-0 ${s.w64}`} onClick={onClose}>
          <span className="text-xs font-medium text-text-secondary">{t('actionMsg.ok', { ns: 'appApi' })}</span>
        </Button>
      </div>

    </Modal>
  )
}

export default SecretKeyGenerateModal
