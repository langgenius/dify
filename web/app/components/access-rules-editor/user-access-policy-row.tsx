'use client'

import type { ResourceUserAccessSetting } from '@/models/access-control'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { memo, useCallback } from 'react'
import { useTranslation } from '#i18n'
import { ACCESS_RULE_TABLE_GRID, DEFAULT_ACCESS_POLICY_ID } from './constants'

type PolicyOption = {
  id: string
  name: string
}

type UserAccessPolicyRowProps = {
  setting: ResourceUserAccessSetting
  policyOptions: PolicyOption[]
  disabled: boolean
  isMaintainer?: boolean
  className?: string
  onChange?: (accountId: string, accessPolicyIds: string[]) => void
  onRemove?: (accountId: string, accessPolicyId: string) => void
}

function UserAccessPolicyRow({
  setting,
  policyOptions,
  disabled,
  isMaintainer = false,
  className,
  onChange,
  onRemove,
}: UserAccessPolicyRowProps) {
  const { t } = useTranslation()
  const accountId = setting.account.account_id
  const selectedPolicy = setting.access_policies[0]
  const selectedAccessPolicyId = selectedPolicy?.id
  const selectedPolicyId = selectedAccessPolicyId ?? DEFAULT_ACCESS_POLICY_ID
  const isPolicySelectDisabled = disabled || isMaintainer || !onChange
  const isRemoveDisabled = disabled || isMaintainer || !onRemove || !selectedAccessPolicyId
  const defaultAccessPolicyName = t('accessRule.defaultPermission', { ns: 'permission' })
  const accountEmail = setting.account.email || setting.account.account_name

  const handlePolicyChange = useCallback((nextPolicyId: string | null) => {
    if (isPolicySelectDisabled || !nextPolicyId || nextPolicyId === selectedPolicyId)
      return

    onChange?.(accountId, [nextPolicyId])
  }, [accountId, isPolicySelectDisabled, onChange, selectedPolicyId])

  const handleRemove = useCallback(() => {
    if (isRemoveDisabled || !selectedAccessPolicyId)
      return

    onRemove?.(accountId, selectedAccessPolicyId)
  }, [accountId, isRemoveDisabled, onRemove, selectedAccessPolicyId])

  return (
    <div className={cn('grid min-h-19 items-center gap-4 px-6 py-4', ACCESS_RULE_TABLE_GRID, className)}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar
          avatar={setting.account.avatar ?? null}
          name={setting.account.account_name}
          size="md"
          className="bg-components-icon-bg-blue-solid"
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate system-md-medium text-text-secondary">
              {setting.account.account_name}
            </span>
            {isMaintainer && (
              <span className="max-w-24 shrink-0 truncate rounded-[5px] border border-text-accent-secondary px-1 py-0.5 system-2xs-medium-uppercase text-text-accent-secondary">
                {t('accessRule.maintainer', { ns: 'permission' })}
              </span>
            )}
          </div>
          <p className="truncate system-xs-regular text-text-tertiary">
            {accountEmail}
          </p>
        </div>
      </div>
      <Select
        value={selectedPolicyId}
        onValueChange={handlePolicyChange}
      >
        <SelectTrigger
          aria-label={t('accessRule.exceptionPermissionFor', { ns: 'permission', name: setting.account.account_name })}
          size="small"
          disabled={isPolicySelectDisabled}
          className="w-36"
        >
          <SelectValue>
            {selectedPolicyId === DEFAULT_ACCESS_POLICY_ID
              ? defaultAccessPolicyName
              : setting.access_policies[0]?.name}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_ACCESS_POLICY_ID}>
            <SelectItemText>{defaultAccessPolicyName}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
          {policyOptions.map(policy => (
            <SelectItem key={policy.id} value={policy.id}>
              <SelectItemText>{policy.name}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        disabled={isRemoveDisabled}
        className="w-fit rounded-md border-none bg-transparent p-0 text-left system-xs-medium text-text-destructive outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:no-underline"
        onClick={handleRemove}
      >
        {t('operation.remove', { ns: 'common' })}
      </button>
    </div>
  )
}

export default memo(UserAccessPolicyRow)
