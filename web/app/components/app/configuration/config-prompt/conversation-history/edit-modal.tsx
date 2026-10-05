'use client'
import type { ConversationHistoriesRole } from '@/models/debug'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  open: boolean
  data: ConversationHistoriesRole
  onOpenChange: (open: boolean) => void
  onSave: (data: ConversationHistoriesRole) => void
}>

export const EditModal = React.memo(({ open, onOpenChange, data, onSave }: Props) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-full max-w-120 overflow-hidden! border-none p-6 text-left align-middle">
      <HistoryForm data={data} onSave={onSave} />
    </DialogContent>
  </Dialog>
))

function HistoryForm({ data, onSave }: Pick<Props, 'data' | 'onSave'>) {
  const { t } = useTranslation(['appDebug', 'common'])
  const [tempData, setTempData] = useState(() => data)
  const id = React.useId()
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave(tempData)
      }}
    >
      <DialogTitle className="title-2xl-semi-bold text-text-primary">
        {t(($) => $['feature.conversationHistory.editModal.title'], { ns: 'appDebug' })}
      </DialogTitle>

      <label
        htmlFor={`${id}-user`}
        className="mt-6 block text-sm leading-5.25 font-medium text-text-primary"
      >
        {t(($) => $['feature.conversationHistory.editModal.userPrefix'], { ns: 'appDebug' })}
      </label>
      <input
        id={`${id}-user`}
        className="mt-2 box-border h-10 w-full rounded-lg bg-components-input-bg-normal px-3 text-sm/10"
        value={tempData.user_prefix}
        onChange={(e) =>
          setTempData({
            ...tempData,
            user_prefix: e.target.value,
          })
        }
      />

      <label
        htmlFor={`${id}-assistant`}
        className="mt-6 block text-sm leading-5.25 font-medium text-text-primary"
      >
        {t(($) => $['feature.conversationHistory.editModal.assistantPrefix'], { ns: 'appDebug' })}
      </label>
      <input
        id={`${id}-assistant`}
        className="mt-2 box-border h-10 w-full rounded-lg bg-components-input-bg-normal px-3 text-sm/10"
        value={tempData.assistant_prefix}
        onChange={(e) =>
          setTempData({
            ...tempData,
            assistant_prefix: e.target.value,
          })
        }
        placeholder={t(($) => $['chat.conversationNamePlaceholder'], { ns: 'common' }) || ''}
      />

      <div className="mt-10 flex justify-end">
        <DialogClose render={<Button className="mr-2 shrink-0" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button variant="primary" className="shrink-0" type="submit">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </form>
  )
}
