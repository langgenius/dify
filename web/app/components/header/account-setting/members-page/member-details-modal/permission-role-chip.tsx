'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from '@langgenius/dify-ui/preview-card'
import { memo, useState } from 'react'
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
  const [open, setOpen] = useState(false)
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
    canOpenMenu && 'cursor-pointer hover:bg-background-section-burn focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
    open && 'bg-background-section-burn',
    className,
  )

  const chipContent = (
    <span className="min-w-0 truncate px-1 leading-4">{label}</span>
  )

  const chip = canOpenMenu
    ? (
        <button
          type="button"
          className={chipClassName}
          aria-label={t('members.memberDetails.roleActionsAria', {
            ns: 'common',
            role: label,
            defaultValue: 'Open actions for {{role}} role',
          })}
          data-testid="permission-role-chip"
          data-role-id={roleId}
        >
          {chipContent}
        </button>
      )
    : (
        <span
          className={chipClassName}
          data-testid="permission-role-chip"
          data-role-id={roleId}
        >
          {chipContent}
        </span>
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

  const chipWithPermissions = (
    <PreviewCard>
      <PreviewCardTrigger render={chip} />
      <PreviewCardContent
        placement="bottom-start"
        sideOffset={8}
        popupClassName="overflow-hidden border-components-panel-border bg-components-tooltip-bg p-0 shadow-lg backdrop-blur-[5px]"
      >
        {permissionSummary}
      </PreviewCardContent>
    </PreviewCard>
  )

  if (!canOpenMenu)
    return chipWithPermissions

  const menuTrigger = (
    <PreviewCard>
      <DropdownMenuTrigger render={<PreviewCardTrigger render={chip} />} />
      <PreviewCardContent
        placement="bottom-start"
        sideOffset={8}
        popupClassName="overflow-hidden border-components-panel-border bg-components-tooltip-bg p-0 shadow-lg backdrop-blur-[5px]"
      >
        {permissionSummary}
      </PreviewCardContent>
    </PreviewCard>
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {menuTrigger}
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-[236px] rounded-xl p-1"
      >
        <DropdownMenuItem
          variant="destructive"
          className="h-8 gap-2 rounded-lg px-2 py-1 system-sm-regular"
          onClick={() => onRemove?.(roleId)}
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
          {t('operation.remove', { ns: 'common' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default memo(PermissionRoleChip)
