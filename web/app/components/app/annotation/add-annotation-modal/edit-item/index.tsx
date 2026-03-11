'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Robot, User } from '@/app/components/base/icons/src/public/avatar'
import Textarea from '@/app/components/base/textarea'

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
  const avatar = type === EditItemType.Query ? <User className="h-6 w-6" /> : <Robot className="h-6 w-6" />
  const name = type === EditItemType.Query ? t('addModal.queryName', { ns: 'appAnnotation' }) : t('addModal.answerName', { ns: 'appAnnotation' })
  const placeholder = type === EditItemType.Query ? t('addModal.queryPlaceholder', { ns: 'appAnnotation' }) : t('addModal.answerPlaceholder', { ns: 'appAnnotation' })

  return (
    <div className="flex" onClick={e => e.stopPropagation()}>
      <div className="mr-3 shrink-0">
        {avatar}
      </div>
      <div className="grow">
        <div className="system-xs-semibold mb-1 text-text-primary">{name}</div>
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
