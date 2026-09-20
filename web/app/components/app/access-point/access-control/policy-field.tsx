'use client'

import type { AccessControlPolicy } from './draft'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import {
  policyIncludesIp,
  splitPolicySummary,
} from '@/app/components/header/account-setting/ip-policies-page/validate-ip-entry'

const CREATE_POLICY_VALUE = '__create-ip-policy__'

type AccessControlPolicyFieldProps = {
  policies: readonly AccessControlPolicy[]
  selectedPolicyId: string | null
  currentIp?: string
  readOnly?: boolean
  canManagePolicies: boolean
  onCreatePolicy: () => void
  onManagePolicies: () => void
  onSelectPolicy: (policyId: string) => void
}

export function AccessControlPolicyField({
  policies,
  selectedPolicyId,
  currentIp,
  readOnly = false,
  canManagePolicies,
  onCreatePolicy,
  onManagePolicies,
  onSelectPolicy,
}: AccessControlPolicyFieldProps) {
  const { t } = useTranslation()
  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId)
  const summary = selectedPolicy ? splitPolicySummary(selectedPolicy.allowed_cidrs) : undefined
  const showLockout =
    Boolean(selectedPolicy && currentIp) &&
    selectedPolicy !== undefined &&
    currentIp !== undefined &&
    !policyIncludesIp(selectedPolicy.allowed_cidrs, currentIp)
  const selectLabel = t(($) => $['studio.accessControl.ipPolicy'], { ns: 'deployments' })
  const placeholder = t(($) => $['studio.accessControl.selectPolicy'], { ns: 'deployments' })
  const canCreatePolicy = canManagePolicies && !readOnly
  const manageLabel = t(($) => $['studio.accessControl.manageIpPolicies'], { ns: 'deployments' })
  const manageButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <IconButton type="button" size="lg" aria-label={manageLabel} onClick={onManagePolicies}>
            <span aria-hidden className="i-ri-equalizer-2-line size-4" />
          </IconButton>
        }
      />
      <TooltipContent>{manageLabel}</TooltipContent>
    </Tooltip>
  )

  if (policies.length === 0) {
    return (
      <div className="flex w-full flex-col items-center gap-3 overflow-hidden rounded-lg border border-dashed border-divider-regular px-4 py-5">
        <p className="w-full text-center system-sm-medium text-text-secondary">
          {t(($) => $['studio.accessControl.emptyPoliciesTitle'], { ns: 'deployments' })}
        </p>
        {canCreatePolicy ? (
          <Button type="button" variant="secondary-accent" onClick={onCreatePolicy}>
            {t(($) => $['studio.accessControl.createIpPolicy'], { ns: 'deployments' })}
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={onManagePolicies}>
            {t(($) => $['studio.accessControl.manageIpPolicies'], { ns: 'deployments' })}
          </Button>
        )}
      </div>
    )
  }

  const policyOptions = (
    <>
      {policies.map((policy) => (
        <SelectItem key={policy.id} value={policy.id}>
          <SelectItemText className="min-w-0 flex-1 truncate">{policy.name}</SelectItemText>
          <span className="shrink-0 system-xs-regular text-text-tertiary">
            {t(($) => $['studio.accessControl.addressCount'], {
              ns: 'deployments',
              count: policy.allowed_cidrs.length,
            })}
          </span>
          <SelectItemIndicator />
        </SelectItem>
      ))}
      {canCreatePolicy && (
        <>
          <SelectSeparator />
          <SelectItem value={CREATE_POLICY_VALUE}>
            <SelectItemText>
              {t(($) => $['studio.accessControl.createIpPolicy'], { ns: 'deployments' })}
            </SelectItemText>
          </SelectItem>
        </>
      )}
    </>
  )

  if (!selectedPolicy) {
    return (
      <div className="flex w-full flex-col gap-1">
        <div className="flex w-full items-center gap-1">
          <div
            className={cn(
              'flex h-8 w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal px-3 py-2 system-sm-regular',
              'text-components-input-text-placeholder',
            )}
          >
            <span className="min-w-0 grow truncate" title={placeholder}>
              {placeholder}
            </span>
            <span
              aria-hidden
              className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary"
            />
          </div>
          {manageButton}
        </div>
        <div className="rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-xs">
          <div role="listbox" aria-label={selectLabel}>
            {policies.map((policy) => (
              <button
                key={policy.id}
                type="button"
                role="option"
                aria-selected={false}
                disabled={readOnly}
                className="flex h-8 w-full cursor-pointer items-center rounded-lg px-2 text-left system-sm-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                onClick={() => {
                  if (!readOnly) onSelectPolicy(policy.id)
                }}
              >
                <span className="min-w-0 flex-1 truncate px-1">{policy.name}</span>
                <span className="shrink-0 system-xs-regular text-text-tertiary">
                  {t(($) => $['studio.accessControl.addressCount'], {
                    ns: 'deployments',
                    count: policy.allowed_cidrs.length,
                  })}
                </span>
              </button>
            ))}
          </div>
          {canCreatePolicy && (
            <>
              <div className="my-1 h-px bg-divider-subtle" />
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={onCreatePolicy}
              >
                {t(($) => $['studio.accessControl.createIpPolicy'], { ns: 'deployments' })}
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex w-full items-center gap-1">
        <Select
          value={selectedPolicyId}
          disabled={readOnly}
          onValueChange={(value) => {
            if (readOnly) return
            if (value === CREATE_POLICY_VALUE) {
              if (canCreatePolicy) onCreatePolicy()
              return
            }
            if (value) onSelectPolicy(value)
          }}
        >
          <SelectTrigger aria-label={selectLabel}>
            <SelectValue placeholder={placeholder}>
              {(value) => policies.find((policy) => policy.id === value)?.name ?? placeholder}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-w-[var(--anchor-width)] min-w-[var(--anchor-width)]">
            {policyOptions}
          </SelectContent>
        </Select>
        {manageButton}
      </div>
      {summary && (
        <p className="system-xs-regular text-text-tertiary">
          {summary.listed.length === 0
            ? t(($) => $['studio.accessControl.policySummaryNone'], { ns: 'deployments' })
            : summary.listed.length === 1
              ? t(($) => $['studio.accessControl.policySummaryOne'], {
                  ns: 'deployments',
                  address: summary.listed[0],
                })
              : summary.moreCount > 0
                ? t(($) => $['studio.accessControl.policySummaryMany'], {
                    ns: 'deployments',
                    listed: summary.listed.join(', '),
                    count: summary.moreCount,
                  })
                : t(($) => $['studio.accessControl.policySummaryTwo'], {
                    ns: 'deployments',
                    first: summary.listed[0],
                    second: summary.listed[1],
                  })}
        </p>
      )}
      {showLockout && currentIp && (
        <p className="system-xs-regular text-text-warning">
          {t(($) => $['studio.accessControl.lockoutWarning'], {
            ns: 'deployments',
            ip: currentIp,
          })}
        </p>
      )}
    </>
  )
}
