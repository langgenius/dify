'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import EditItem, { EditItemType } from './edit-item'
import Drawer from '@/app/components/base/drawer-plus'
type Props = {
  isShow: boolean
  onHide: () => void
  query: string
  answer: string
  onSave: (editedQuery: string, editedAnswer: string) => void
  id: string
  createdAt: string
  onRemove: () => void
}

const EditReplyModal: FC<Props> = ({
  isShow,
  onHide,
  query,
  answer,
  onSave,
  id,
  createdAt,
  onRemove,
}) => {
  const { t } = useTranslation()

  const handleSave = (type: EditItemType, editedContent: string) => {
    if (type === EditItemType.Query)
      onSave(editedContent, answer)
    else
      onSave(query, editedContent)
  }
  return (
    <Drawer
      isShow={isShow}
      onHide={onHide}
      title={t('appDebug.annotation.editReply') as string}
      body={(
        <div className='space-y-2'>
          <EditItem
            type={EditItemType.Query}
            content={query}
            onSave={editedContent => handleSave(EditItemType.Query, editedContent)}
          />
          <EditItem
            type={EditItemType.Answer}
            content={query}
            onSave={editedContent => handleSave(EditItemType.Answer, editedContent)}
          />
        </div>
      )}
      foot={id
        ? (
          <div className='flex justify-between'>
            <div>Remove</div>
            <div>{createdAt}</div>
          </div>
        )
        : undefined}
    >
    </Drawer>
  )
}
export default React.memo(EditReplyModal)
