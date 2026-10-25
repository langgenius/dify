'use client'

import type { SelectorKey } from 'i18next'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { memo, Suspense } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

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
  const { t } = useTranslation(['common'])
  const canRemoveRole = !isOwner && !!onRemove

  const chipRootClassName = cn(
    'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border-[0.5px] border-components-panel-border-subtle bg-background-body px-1.5 py-0.5 system-xs-medium text-text-primary shadow-xs transition-colors',
    'hover:bg-background-section-burn has-data-popup-open:bg-background-section-burn',
    className,
  )

  const removeLabel = `${t(($) => $['operation.remove'], { ns: 'common' })} ${label}`

  const chip = (
    <span className={chipRootClassName}>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        render={
          <button
            type="button"
            className="min-w-0 truncate rounded-sm border-none bg-transparent p-0 text-start leading-4"
          >
            {label}
          </button>
        }
      />
      {canRemoveRole && (
        <IconButton
          size="xs"
          aria-label={removeLabel}
          className="shrink-0 rounded-full"
          onClick={() => onRemove?.(roleId)}
        >
          <span aria-hidden className="i-ri-close-line size-3" />
        </IconButton>
      )}
    </span>
  )

  return (
    <Popover>
      {chip}
      <PopoverContent
        align="start"
        className="overflow-hidden border-components-panel-border bg-components-tooltip-bg p-0 shadow-lg backdrop-blur-[5px]"
      >
        <Suspense fallback={<LoadingPlaceholder className="p-4" />}>
          <PermissionSummary label={label} permissionKeys={permissionKeys} />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}

function PermissionSummary({
  label,
  permissionKeys,
}: Pick<PermissionRoleChipProps, 'label' | 'permissionKeys'>) {
  const { t } = useTranslation(['permissionKeys', 'workspaceMembers'])
  // Permission keys come from the catalog API, so this is a reviewed open-key boundary with a server-provided fallback.
  const translatePermissionName = (key: string) =>
    t(key as SelectorKey, {
      ns: 'permissionKeys',
      defaultValue: key,
    })
  const permissionLabels = permissionKeys.map(translatePermissionName).join(', ')
  const hasPermissionLabels = permissionLabels.length > 0

  return (
    <div className="flex w-58 flex-col gap-1 px-4 py-3.5">
      <div className="title-xs-semi-bold leading-4 whitespace-nowrap text-text-primary">
        {label}
      </div>
      <div className="body-xs-regular text-text-secondary">
        {hasPermissionLabels ? (
          <Trans
            i18nKey={($) => $['members.memberDetails.rolePermissionSummary']}
            ns="workspaceMembers"
            values={{
              role: label,
              permissions: permissionLabels,
            }}
            components={{
              permissionList: <span className="text-text-accent" />,
            }}
          />
        ) : (
          t(($) => $['members.memberDetails.roleNoPermissionSummary'], {
            ns: 'workspaceMembers',
            defaultValue: 'Current role has no permissions.',
          })
        )}
      </div>
    </div>
  )
}

export default memo(PermissionRoleChip)
