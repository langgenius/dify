'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from '@langgenius/dify-ui/preview-card'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { getRolePermissionKeys } from './role-permissions'

export type PermissionRoleChipProps = {
  roleKey: string
  label: string
  highlighted?: boolean
  onRemove?: () => void
  className?: string
}

const PermissionRoleChip = ({
  roleKey,
  label,
  highlighted = false,
  onRemove,
  className,
}: PermissionRoleChipProps) => {
  const { t } = useTranslation()
  const permissions = getRolePermissionKeys(roleKey)
  const hasPermissions = permissions.length > 0

  const chip = (
    <span
      className={cn(
        'inline-flex h-6 max-w-full cursor-default items-center gap-1 rounded-md px-1.5 system-xs-medium shadow-xs',
        highlighted
          ? 'bg-state-accent-hover text-text-accent'
          : 'bg-background-body text-text-secondary',
        className,
      )}
      data-testid="permission-role-chip"
      data-role-key={roleKey}
    >
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={t('members.memberDetails.removeRoleAria', {
            ns: 'common',
            role: label,
            defaultValue: 'Remove {{role}} role',
          })}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded hover:bg-black/5',
            highlighted ? 'text-text-accent' : 'text-text-tertiary',
          )}
        >
          <span aria-hidden className="i-ri-close-line h-3 w-3" />
        </button>
      )}
    </span>
  )

  if (!hasPermissions)
    return chip

  return (
    <PreviewCard>
      <PreviewCardTrigger render={chip} />
      <PreviewCardContent
        placement="bottom-start"
        popupClassName="min-w-[200px] max-w-[280px] p-3"
      >
        <div className="mb-2 system-sm-semibold text-text-accent">
          {label}
        </div>
        <ul className="flex flex-col gap-1.5 system-xs-regular text-text-secondary">
          {permissions.map(key => (
            <li key={key} className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-[7px] inline-block h-1 w-1 shrink-0 rounded-full bg-text-tertiary"
              />
              <span>
                {t(`members.memberDetails.permissions.${key}`, {
                  ns: 'common',
                  defaultValue: key,
                })}
              </span>
            </li>
          ))}
        </ul>
      </PreviewCardContent>
    </PreviewCard>
  )
}

export default memo(PermissionRoleChip)
