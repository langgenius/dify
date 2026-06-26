'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { memo } from 'react'
import { Trans, useTranslation } from 'react-i18next'

type PermissionRoleChipProps = {
  roleId: string
  label: string
  isOwner: boolean
  permissionKeys: string[]
  onRemove?: (roleId: string) => void
  className?: string
}

const PermissionRoleChip = ({
  roleId,
  label,
  isOwner,
  permissionKeys,
  onRemove,
  className,
}: PermissionRoleChipProps) => {
  const { t } = useTranslation()
  const permissions = permissionKeys
  const canOpenMenu = !isOwner && !!onRemove
  const permissionLabels = permissions
    .map(key => t(key, {
      ns: 'permissionKeys',
      defaultValue: key,
    }))
    .join(', ')
  const hasPermissionLabels = permissionLabels.length > 0

  const chipClassName = cn(
    'inline-flex h-6 max-w-full items-center rounded-full border-[0.5px] border-components-panel-border-subtle bg-background-body p-1 system-xs-regular text-text-primary shadow-xs transition-colors outline-none',
    'cursor-pointer hover:bg-background-section-burn focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-background-section-burn',
    className,
  )

  const chipContent = (
    <span className="min-w-0 truncate px-1 leading-4">{label}</span>
  )

  const chipAriaLabel = canOpenMenu
    ? t('members.memberDetails.roleActionsAria', {
        ns: 'common',
        role: label,
        defaultValue: 'Open actions for {{role}} role',
      })
    : undefined

  const chip = (
    <button
      type="button"
      className={chipClassName}
      aria-label={chipAriaLabel}
    >
      {chipContent}
    </button>
  )

  const permissionSummary = (
    <div className="flex w-58 flex-col gap-1 px-4 py-3.5">
      <div className="title-xs-semi-bold leading-4 whitespace-nowrap text-text-primary">
        {label}
      </div>
      <div className="body-xs-regular text-text-secondary">
        {hasPermissionLabels
          ? (
              <Trans
                i18nKey="members.memberDetails.rolePermissionSummary"
                ns="common"
                values={{
                  role: label,
                  permissions: permissionLabels,
                }}
                components={{
                  permissionList: <span className="text-text-accent" />,
                }}
              />
            )
          : t('members.memberDetails.roleNoPermissionSummary', {
              ns: 'common',
              defaultValue: 'Current role has no permissions.',
            })}
      </div>
    </div>
  )

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        render={chip}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={8}
        popupClassName="overflow-hidden border-components-panel-border bg-components-tooltip-bg p-0 shadow-lg backdrop-blur-[5px]"
      >
        {permissionSummary}
        {canOpenMenu && (
          <div className="border-t border-divider-subtle p-1">
            <PopoverClose
              render={(
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2 py-1 system-sm-regular text-text-destructive hover:bg-state-destructive-hover focus-visible:bg-state-destructive-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                />
              )}
              onClick={() => onRemove?.(roleId)}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
              {t('operation.remove', { ns: 'common' })}
            </PopoverClose>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default memo(PermissionRoleChip)
