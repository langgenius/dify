'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from '@/app/components/base/textarea'
import { Robot, User } from '@/app/components/base/icons/src/public/avatar'

export enum EditItemType {
  Query = 'query',
  Answer = 'answer',
}
type Props = {
  type: EditItemType
  content: string
  onChange: (content: string) => void
}

const EditItem: FC<Props> = ({
  type,
  content,
  onChange,
}) => {
  const { t } = useTranslation()
  const avatar = type === EditItemType.Query ? <User className='w-6 h-6' /> : <Robot className='w-6 h-6' />
  const name = type === EditItemType.Query ? t('appAnnotation.addModal.queryName') : t('appAnnotation.addModal.answerName')
  const placeholder = type === EditItemType.Query ? t('appAnnotation.addModal.queryPlaceholder') : t('appAnnotation.addModal.answerPlaceholder')

  return (
    <div className='flex' onClick={e => e.stopPropagation()}>
      <div className='shrink-0 mr-3'>
        {avatar}
      </div>
      <div className='grow'>
        <div className='mb-1 system-xs-semibold text-text-primary'>{name}</div>
        <Textarea
          value={content}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
      </div>
    </div>
  )
}
export default React.memo(EditItem)
