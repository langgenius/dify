'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import type { ConversationHistoriesRole } from '@/models/debug'
import Button from '@/app/components/base/button'
type Props = {
  isShow: boolean
  saveLoading: boolean
  data: ConversationHistoriesRole
  onClose: () => void
  onSave: (data: any) => void
}

const EditModal: FC<Props> = ({
  isShow,
  saveLoading,
  data,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation()
  const [tempData, setTempData] = useState(data)
  return (
    <Modal
      title={t('appDebug.feature.conversationHistory.editModal.title')}
      isShow={isShow}
      onClose={onClose}
    >
      <div className={'mt-6 font-medium text-sm leading-[21px] text-gray-900'}>{t('appDebug.feature.conversationHistory.editModal.userPrefix')}</div>
      <input className={'mt-2 w-full rounded-lg h-10 box-border px-3 text-sm leading-10 bg-gray-100'}
        value={tempData.user_prefix}
        onChange={e => setTempData({
          ...tempData,
          user_prefix: e.target.value,
        })}
      />

      <div className={'mt-6 font-medium text-sm leading-[21px] text-gray-900'}>{t('appDebug.feature.conversationHistory.editModal.assistantPrefix')}</div>
      <input className={'mt-2 w-full rounded-lg h-10 box-border px-3 text-sm leading-10 bg-gray-100'}
        value={tempData.assistant_prefix}
        onChange={e => setTempData({
          ...tempData,
          assistant_prefix: e.target.value,
        })}
        placeholder={t('common.chat.conversationNamePlaceholder') || ''}
      />

      <div className='mt-10 flex justify-end'>
        <Button className='mr-2 flex-shrink-0' onClick={onClose}>{t('common.operation.cancel')}</Button>
        <Button variant='primary' className='flex-shrink-0' onClick={() => onSave(tempData)} loading={saveLoading}>{t('common.operation.save')}</Button>
      </div>
    </Modal>
  )
}

export default React.memo(EditModal)
