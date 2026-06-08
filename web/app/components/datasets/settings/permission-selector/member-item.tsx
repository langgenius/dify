import { cn } from '@langgenius/dify-ui/cn'
import { RiCheckLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

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
      className="flex cursor-pointer items-center gap-2 rounded-lg py-1 pr-[10px] pl-2 hover:bg-state-base-hover"
      onClick={onClick}
    >
      {leftIcon}
      <div className="grow">
        <div className="truncate system-sm-medium text-text-secondary">
          {name}
          {isMe && (
            <span className="system-xs-regular text-text-tertiary">
              {t('form.me', { ns: 'datasetSettings' })}
            </span>
          )}
        </div>
        <div className="truncate system-xs-regular text-text-tertiary">{email}</div>
      </div>
      {isSelected && <RiCheckLine className={cn('size-4 shrink-0 text-text-accent', isMe && 'opacity-30')} />}
    </div>
  )
}

export default React.memo(MemberItem)
