import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

type MemberItemProps = {
  leftIcon: ReactNode
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

  const content = (
    <>
      {leftIcon}
      <div className="min-w-0 grow">
        <div className="truncate system-sm-medium text-text-secondary">
          {name}
          {isMe && (
            <span className="system-xs-regular text-text-tertiary">
              {t(($) => $['form.me'], { ns: 'datasetSettings' })}
            </span>
          )}
        </div>
        <div className="truncate system-xs-regular text-text-tertiary">{email}</div>
      </div>
      {isSelected && (
        <span
          aria-hidden="true"
          className={cn('i-ri-check-line size-4 shrink-0 text-text-accent', isMe && 'opacity-30')}
        />
      )}
    </>
  )

  if (isMe) {
    return <div className="flex items-center gap-2 rounded-lg py-1 pr-[10px] pl-2">{content}</div>
  }

  return (
    <button
      type="button"
      className="flex w-full cursor-pointer touch-manipulation items-center gap-2 rounded-lg border-none bg-transparent py-1 pr-[10px] pl-2 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      aria-pressed={isSelected}
      onClick={onClick}
    >
      {content}
    </button>
  )
}

export default MemberItem
