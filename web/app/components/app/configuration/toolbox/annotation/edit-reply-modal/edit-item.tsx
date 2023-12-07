'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

export enum EditItemType {
  Query = 'query',
  Answer = 'answer',
}
type Props = {
  type: EditItemType
  content: string
  onSave: (content: string) => void
}

const EditItem: FC<Props> = ({
  type,
  content,
  onSave,
}) => {
  const { t } = useTranslation()
  const [newContent, setNewContent] = useState(content)
  const avatar = type === EditItemType.Query ? 'Q' : 'A'
  const name = type = EditItemType.Query ? t('appDebug.feature.annotation.editModal.queryName') : t('appDebug.feature.annotation.editModal.answerName')
  const [isEdit, setIsEdit] = useState(false)

  const handleSave = () => {
    onSave(newContent)
    setIsEdit(false)
  }

  const handleCancel = () => {
    setNewContent(content)
    setIsEdit(false)
  }

  return (
    <div className='flex'>
      <div>
        {avatar}
      </div>
      <div>
        <div>{name}</div>
        <div>{content}</div>
        {!isEdit
          ? (
            <div>
            Edit
            </div>
          )
          : (
            <div>
              <div>
              Your Answer
              </div>
            </div>
          )}
      </div>
    </div>
  )
}
export default React.memo(EditItem)
