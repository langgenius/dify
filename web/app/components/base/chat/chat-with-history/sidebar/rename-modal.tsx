'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

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
      title={t('common.chat.renameConversation')}
      isShow={isShow}
      onClose={onClose}
    >
      <div className={'mt-6 font-medium text-sm leading-[21px] text-gray-900'}>{t('common.chat.conversationName')}</div>
      <input className={'mt-2 w-full rounded-lg h-10 box-border px-3 text-sm leading-10 bg-gray-100'}
        value={tempName}
        onChange={e => setTempName(e.target.value)}
        placeholder={t('common.chat.conversationNamePlaceholder') || ''}
      />

      <div className='mt-10 flex justify-end'>
        <Button className='mr-2 flex-shrink-0' onClick={onClose}>{t('common.operation.cancel')}</Button>
        <Button variant='primary' className='flex-shrink-0' onClick={() => onSave(tempName)} loading={saveLoading}>{t('common.operation.save')}</Button>
      </div>
    </Modal>
  )
}
export default React.memo(RenameModal)
