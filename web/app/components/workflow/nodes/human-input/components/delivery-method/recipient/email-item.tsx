import type { Recipient as RecipientItem } from '../../../types'
import type { Member } from '@/models/common'
import { RiCloseCircleFill, RiErrorWarningFill } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Avatar from '@/app/components/base/avatar'
import { cn } from '@/utils/classnames'

type Props = {
  email: string
  data: Member
  disabled?: boolean
  onDelete: (recipient: RecipientItem) => void
  isError: boolean
}

const EmailItem = ({
  email,
  data,
  onDelete,
  disabled = false,
  isError,
}: Props) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'flex h-6 items-center gap-1 rounded-full border border-components-panel-border-subtle bg-components-badge-white-to-dark p-1 shadow-xs',
        isError && 'border-state-destructive-hover-alt bg-state-destructive-hover',
      )}
      onClick={e => e.stopPropagation()}
    >
      {isError && (
        <RiErrorWarningFill className="h-4 w-4 text-text-destructive" />
      )}
      {!isError && <Avatar avatar={data.avatar_url} size={16} name={data.name || data.email} />}
      <div title={data.email} className="system-xs-regular max-w-[500px] truncate text-text-primary">
        {email === data.email ? data.name : data.email}
        {email === data.email && <span className="system-xs-regular text-text-tertiary">{t('members.you', { ns: 'common' })}</span>}
      </div>
      {!disabled && (
        <RiCloseCircleFill
          className="h-4 w-4 cursor-pointer text-text-quaternary hover:text-text-tertiary"
          onClick={() => onDelete(data as unknown as RecipientItem)}
        />
      )}
    </div>
  )
}

export default EmailItem
