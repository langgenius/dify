'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
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
  const canRemoveRole = !isOwner && !!onRemove
  const permissionLabels = permissions
    .map(key => t($ => $[key], {
      ns: 'permissionKeys',
      defaultValue: key,
    }))
    .join(', ')
  const hasPermissionLabels = permissionLabels.length > 0

  const chipRootClassName = cn(
    'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border-[0.5px] border-components-panel-border-subtle bg-background-body px-1.5 py-0.5 system-xs-medium text-text-primary shadow-xs transition-colors',
    'hover:bg-background-section-burn has-[[data-popup-open]]:bg-background-section-burn',
    'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-state-accent-solid',
    className,
  )

  const removeLabel = `${t($ => $['operation.remove'], { ns: 'common' })} ${label}`

  const chip = (
    <span className={chipRootClassName}>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        render={(
          <button
            type="button"
            className="min-w-0 truncate rounded-sm border-none bg-transparent p-0 text-start leading-4 outline-hidden"
          >
            {label}
          </button>
        )}
      />
      {canRemoveRole && (
        <button
          type="button"
          aria-label={removeLabel}
          className="flex size-3.5 shrink-0 items-center justify-center rounded-full border-none bg-transparent p-0 text-text-tertiary outline-hidden hover:bg-state-base-hover-alt hover:text-text-secondary focus-visible:bg-state-base-hover-alt focus-visible:text-text-secondary"
          onClick={() => onRemove?.(roleId)}
        >
          <span aria-hidden className="i-ri-close-line size-3" />
        </button>
      )}
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
                i18nKey={$ => $["members.memberDetails.rolePermissionSummary"]}
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
          : t($ => $['members.memberDetails.roleNoPermissionSummary'], {
              ns: 'common',
              defaultValue: 'Current role has no permissions.',
            })}
      </div>
    </div>
  )

  return (
    <Popover>
      {chip}
      <PopoverContent
        placement="bottom-start"
        sideOffset={8}
        popupClassName="overflow-hidden border-components-panel-border bg-components-tooltip-bg p-0 shadow-lg backdrop-blur-[5px]"
      >
        {permissionSummary}
      </PopoverContent>
    </Popover>
  )
}

export default memo(PermissionRoleChip)
