'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'

type IRenameModalProps = {
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
  const conversationNamePlaceholder = t('chat.conversationNamePlaceholder', { ns: 'common' }) || ''

  return (
    <Dialog
      open={isShow}
      onOpenChange={open => !open && onClose()}
    >
      <DialogContent>
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('chat.renameConversation', { ns: 'common' })}
        </DialogTitle>
        <div className="mt-6 text-sm leading-[21px] font-medium text-text-primary">{t('chat.conversationName', { ns: 'common' })}</div>
        <Input
          className="mt-2 h-10 w-full"
          value={tempName}
          onChange={e => setTempName(e.target.value)}
          placeholder={conversationNamePlaceholder}
        />

        <div className="mt-10 flex justify-end">
          <Button className="mr-2 shrink-0" onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
          <Button variant="primary" className="shrink-0" onClick={() => onSave(tempName)} loading={saveLoading}>{t('operation.save', { ns: 'common' })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(RenameModal)
