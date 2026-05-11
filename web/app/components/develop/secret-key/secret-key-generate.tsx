'use client'
import type { CreateApiKeyResponse } from '@/models/app'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
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
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open)
          onClose()
      }}
    >
      <DialogContent className={cn('w-full max-w-[480px] overflow-hidden! border-none px-8 text-left align-middle', className)}>
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {`${t('apiKeyModal.apiSecretKey', { ns: 'appApi' })}`}
        </DialogTitle>

        <div className="-mt-6 -mr-2 mb-4 flex justify-end">
          <XMarkIcon className="h-6 w-6 cursor-pointer text-text-tertiary" onClick={onClose} />
        </div>
        <p className="mt-1 text-[13px] leading-5 font-normal text-text-tertiary">{t('apiKeyModal.generateTips', { ns: 'appApi' })}</p>
        <div className="my-4">
          <InputCopy className="w-full" value={newKey?.token} />
        </div>
        <div className="my-4 flex justify-end">
          <Button className={`shrink-0 ${s.w64}`} onClick={onClose}>
            <span className="text-xs font-medium text-text-secondary">{t('actionMsg.ok', { ns: 'appApi' })}</span>
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  )
}

export default SecretKeyGenerateModal
