import { RiCheckLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type MemberItemProps = {
  leftIcon: React.ReactNode
  name: string
  email: string
  isSelected: boolean
  isMe?: boolean
  onClick?: () => void
}

const MemberItem = ({
  leftIcon,
  name,
  email,
  isSelected,
  isMe = false,
  onClick,
}: MemberItemProps) => {
  const { t } = useTranslation()

  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded-lg py-1 pl-2 pr-[10px] hover:bg-state-base-hover"
      onClick={onClick}
    >
      {leftIcon}
      <div className="grow">
        <div className="truncate text-text-secondary system-sm-medium">
          {name}
          {isMe && (
            <span className="text-text-tertiary system-xs-regular">
              {t('form.me', { ns: 'datasetSettings' })}
            </span>
          )}
        </div>
        <div className="truncate text-text-tertiary system-xs-regular">{email}</div>
      </div>
      {isSelected && <RiCheckLine className={cn('size-4 shrink-0 text-text-accent', isMe && 'opacity-30')} />}
    </div>
  )
}

export default React.memo(MemberItem)
