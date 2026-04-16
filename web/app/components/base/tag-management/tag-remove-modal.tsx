'use client'

import type { Tag } from '@/app/components/base/tag-management/constant'
import { cn } from '@langgenius/dify-ui/cn'
import { noop } from 'es-toolkit/function'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Modal from '@/app/components/base/modal'
import { Button } from '@/app/components/base/ui/button'

type TagRemoveModalProps = {
  show: boolean
  tag: Tag
  onConfirm: () => void
  onClose: () => void
}

const TagRemoveModal = ({ show, tag, onConfirm, onClose }: TagRemoveModalProps) => {
  const { t } = useTranslation()

  return (
    <Modal
      className={cn('w-[480px] max-w-[480px] p-8')}
      isShow={show}
      onClose={noop}
    >
      <div className="absolute top-4 right-4 cursor-pointer p-2" onClick={onClose} data-testid="tag-remove-modal-close-button">
        <span className="i-ri-close-line h-4 w-4 text-text-tertiary" />
      </div>
      <div className="h-12 w-12 rounded-xl border-[0.5px] border-divider-regular bg-background-default-burn p-3 shadow-xl">
        <AlertTriangle className="h-6 w-6 text-[rgb(247,144,9)]" />
      </div>
      <div className="mt-3 text-xl leading-[30px] font-semibold text-text-primary">
        {`${t('tag.delete', { ns: 'common' })} `}
        <span>{`"${tag.name}"`}</span>
      </div>
      <div className="my-1 text-sm leading-5 text-text-tertiary">
        {t('tag.deleteTip', { ns: 'common' })}
      </div>
      <div className="flex items-center justify-end pt-6">
        <Button className="mr-2" onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button className="border-red-700" variant="primary" tone="destructive" onClick={onConfirm}>{t('operation.delete', { ns: 'common' })}</Button>
      </div>
    </Modal>
  )
}

export default TagRemoveModal
