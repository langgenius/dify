'use client'
import type { FC } from 'react'
import type { ConversationHistoriesRole } from '@/models/debug'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'

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
      title={t('feature.conversationHistory.editModal.title', { ns: 'appDebug' })}
      isShow={isShow}
      onClose={onClose}
    >
      <div className="mt-6 text-sm font-medium leading-[21px] text-text-primary">{t('feature.conversationHistory.editModal.userPrefix', { ns: 'appDebug' })}</div>
      <input
        className="mt-2 box-border h-10 w-full rounded-lg bg-components-input-bg-normal px-3 text-sm leading-10"
        value={tempData.user_prefix}
        onChange={e => setTempData({
          ...tempData,
          user_prefix: e.target.value,
        })}
      />

      <div className="mt-6 text-sm font-medium leading-[21px] text-text-primary">{t('feature.conversationHistory.editModal.assistantPrefix', { ns: 'appDebug' })}</div>
      <input
        className="mt-2 box-border h-10 w-full rounded-lg bg-components-input-bg-normal px-3 text-sm leading-10"
        value={tempData.assistant_prefix}
        onChange={e => setTempData({
          ...tempData,
          assistant_prefix: e.target.value,
        })}
        placeholder={t('chat.conversationNamePlaceholder', { ns: 'common' }) || ''}
      />

      <div className="mt-10 flex justify-end">
        <Button className="mr-2 shrink-0" onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button variant="primary" className="shrink-0" onClick={() => onSave(tempData)} loading={saveLoading}>{t('operation.save', { ns: 'common' })}</Button>
      </div>
    </Modal>
  )
}

export default React.memo(EditModal)
