'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Robot, User } from '@/app/components/base/icons/src/public/avatar'
import { Edit04 } from '@/app/components/base/icons/src/vender/line/general'

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
  const avatar = type === EditItemType.Query ? <User className='w-6 h-6' /> : <Robot className='w-6 h-6' />
  const name = type === EditItemType.Query ? t('appDebug.feature.annotation.editModal.queryName') : t('appDebug.feature.annotation.editModal.answerName')
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
      <div className='shrink-0 mr-3'>
        {avatar}
      </div>
      <div>
        <div className='mb-1 leading-[18px] text-xs font-semibold text-gray-900'>{name}</div>
        <div className='leading-5 text-sm font-normal text-gray-900'>{content}</div>
        {!isEdit
          ? (
            <div
              className='mt-2 flex items-center space-x-1 leading-[18px] text-xs font-medium text-[#155EEF] cursor-pointer'
              onClick={(e) => {
                e.stopPropagation()
                setIsEdit(true)
              }}
            >
              <Edit04 className='w-3.5 h-3.5' />
              <div>{t('common.operation.edit')}</div>
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
