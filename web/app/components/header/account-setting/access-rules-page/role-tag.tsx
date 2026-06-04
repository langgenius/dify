'use client'

import type { BindingType } from '@/models/access-control'
import {
  AvatarFallback,
  AvatarImage,
  AvatarRoot,
} from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type RoleTagProps = {
  id: string
  bindingId: string
  label: string
  type: BindingType
  avatar?: string | null
  isLocked?: boolean
  showRemove?: boolean
  onRemove?: (id: string, type: BindingType) => void
  canChangeLockStatus?: boolean
  onToggleLockStatus?: (id: string, newStatus: boolean) => void
  className?: string
}

const RoleTagAvatar = ({
  label,
  avatar,
}: {
  label: string
  avatar?: string | null
}) => (
  <AvatarRoot
    size="xxs"
    className="border-[0.5px] border-divider-regular bg-util-colors-indigo-indigo-50"
  >
    {avatar && (
      <AvatarImage
        src={avatar}
        alt={label}
      />
    )}
    <AvatarFallback
      size="xxs"
      className="text-2xs leading-[1.2] font-medium text-util-colors-indigo-indigo-600"
    >
      {label?.[0]?.toLocaleUpperCase()}
    </AvatarFallback>
  </AvatarRoot>
)

const RoleTag = ({
  id,
  bindingId,
  label,
  type,
  avatar,
  isLocked = false,
  showRemove = false,
  onRemove,
  canChangeLockStatus = false,
  onToggleLockStatus,
  className,
}: RoleTagProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const isMember = type === 'account'
  const canShowRemove = showRemove && !!onRemove && (canChangeLockStatus || !isLocked)
  const canOpenMenu = canShowRemove || canChangeLockStatus

  const chipClassName = cn(
    'inline-flex h-6 max-w-full items-center rounded-full border-[0.5px] border-components-panel-border-subtle bg-background-section p-1 system-xs-regular text-text-primary transition-colors outline-none',
    canOpenMenu && 'cursor-pointer hover:bg-background-section-burn focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
    open && 'bg-background-section-burn',
    className,
  )

  const chipContent = (
    <>
      {isMember && (
        <RoleTagAvatar
          label={label}
          avatar={avatar}
        />
      )}
      <span className="min-w-0 truncate px-1 leading-4">{label}</span>
      {isLocked && (
        <span
          aria-hidden
          className="i-ri-lock-line size-3 shrink-0 text-text-tertiary"
        />
      )}
    </>
  )

  if (!canOpenMenu) {
    return (
      <span
        className={chipClassName}
        data-testid="access-rule-role-tag"
      >
        {chipContent}
      </span>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={(
          <button
            type="button"
            className={chipClassName}
            aria-label={t('accessRule.bindingActionsAria', { ns: 'permission', name: label })}
            data-testid="access-rule-role-tag"
          />
        )}
      >
        {chipContent}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-[236px] rounded-xl p-1"
      >
        {canChangeLockStatus && (
          <DropdownMenuItem
            className="h-8 gap-2 rounded-lg px-2 py-1 system-sm-regular text-text-secondary"
            onClick={() => {
              onToggleLockStatus?.(bindingId, !isLocked)
            }}
          >
            <span
              aria-hidden
              className={cn('size-4 shrink-0', isLocked ? 'i-ri-lock-unlock-line' : 'i-ri-lock-line')}
            />
            {t(isLocked ? 'accessRule.unlockBinding' : 'accessRule.lockBinding', { ns: 'permission' })}
          </DropdownMenuItem>
        )}
        {
          canChangeLockStatus && canShowRemove && (
            <DropdownMenuSeparator className="my-0" />
          )
        }
        {canShowRemove && (
          <DropdownMenuItem
            variant="destructive"
            className="h-8 gap-2 rounded-lg px-2 py-1 system-sm-regular"
            onClick={() => {
              onRemove(id, type)
            }}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
            {t('operation.remove', { ns: 'common' })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default memo(RoleTag)
