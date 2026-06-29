'use client'
import type { FC } from 'react'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
import { useTranslation } from '#i18n'
import { Robot, User } from '@/app/components/base/icons/src/public/avatar'

export enum EditItemType {
  Query = 'query',
  Answer = 'answer',
}
type Props = Readonly<{
  type: EditItemType
  content: string
  onChange: (content: string) => void
}>

const EditItem: FC<Props> = ({
  type,
  content,
  onChange,
}) => {
  const { t } = useTranslation()
  const avatar = type === EditItemType.Query ? <User className="size-6" /> : <Robot className="size-6" />
  const name = type === EditItemType.Query ? t('addModal.queryName', { ns: 'appAnnotation' }) : t('addModal.answerName', { ns: 'appAnnotation' })
  const placeholder = type === EditItemType.Query ? t('addModal.queryPlaceholder', { ns: 'appAnnotation' }) : t('addModal.answerPlaceholder', { ns: 'appAnnotation' })

  return (
    <div className="flex" onClick={e => e.stopPropagation()}>
      <div className="mr-3 shrink-0">
        {avatar}
      </div>
      <div className="grow">
        <div className="mb-1 system-xs-semibold text-text-primary">{name}</div>
        <Textarea
          aria-label={name}
          value={content}
          onValueChange={value => onChange(value)}
          placeholder={placeholder}
          autoFocus
        />
      </div>
    </div>
  )
}
export default React.memo(EditItem)
