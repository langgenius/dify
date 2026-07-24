'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'

export type IRenameModalProps = {
  isShow: boolean
  saveLoading: boolean
  name: string
  onClose: () => void
  onSave: (name: string) => void
}

const RenameModal: FC<IRenameModalProps> = ({
  isShow,
  saveLoading,
  name,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation()
  const [tempName, setTempName] = useState(name)

  return (
    <Modal
      title={t('chat.renameConversation', { ns: 'common' })}
      isShow={isShow}
      onClose={onClose}
    >
      <div className="mt-6 text-sm font-medium leading-[21px] text-text-primary">{t('chat.conversationName', { ns: 'common' })}</div>
      <Input
        className="mt-2 h-10 w-full"
        value={tempName}
        onChange={e => setTempName(e.target.value)}
        placeholder={t('chat.conversationNamePlaceholder', { ns: 'common' }) || ''}
      />

      <div className="mt-10 flex justify-end">
        <Button className="mr-2 shrink-0" onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button variant="primary" className="shrink-0" onClick={() => onSave(tempName)} loading={saveLoading}>{t('operation.save', { ns: 'common' })}</Button>
      </div>
    </Modal>
  )
}
export default React.memo(RenameModal)
