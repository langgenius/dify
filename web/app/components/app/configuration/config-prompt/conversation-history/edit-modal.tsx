'use client'
import type { FC } from 'react'
import type { ConversationHistoriesRole } from '@/models/debug'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open)
          onClose()
      }}
    >
      <DialogContent className="w-full max-w-[480px] overflow-hidden! border-none p-6 text-left align-middle">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('feature.conversationHistory.editModal.title', { ns: 'appDebug' })}
        </DialogTitle>

        <div className="mt-6 text-sm leading-[21px] font-medium text-text-primary">{t('feature.conversationHistory.editModal.userPrefix', { ns: 'appDebug' })}</div>
        <input
          className="mt-2 box-border h-10 w-full rounded-lg bg-components-input-bg-normal px-3 text-sm leading-10"
          value={tempData.user_prefix}
          onChange={e => setTempData({
            ...tempData,
            user_prefix: e.target.value,
          })}
        />

        <div className="mt-6 text-sm leading-[21px] font-medium text-text-primary">{t('feature.conversationHistory.editModal.assistantPrefix', { ns: 'appDebug' })}</div>
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
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(EditModal)
