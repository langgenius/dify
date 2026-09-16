'use client'

import type { AccessControlDraft, AccessControlPolicy } from './draft'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { PopoverTitle } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'
import { splitPolicySummary } from '@/app/components/header/account-setting/ip-policies-page/validate-ip-entry'
import { getInServiceCoverage } from './chip-status'

const SCOPE_ICONS: Record<Exclude<AccessPoint, 'webApp'>, string> = {
  serviceApi: 'i-custom-vender-knowledge-api-aggregate',
  mcp: 'i-custom-vender-integrations-mcp',
  trigger: 'i-custom-vender-integrations-trigger',
}

type AccessControlStatusPanelProps = {
  draft: AccessControlDraft
  policies: readonly AccessControlPolicy[]
  enabled: boolean
  onEdit: () => void
  updating?: boolean
  dirty?: boolean
  canSave?: boolean
  readOnly?: boolean
  onUpgrade?: () => void
  onCancel?: () => void
  onSave?: () => void
  onEnabledChange: (enabled: boolean) => void
}

export function AccessControlStatusPanel({
  draft,
  policies,
  enabled,
  onEdit,
  updating = false,
  dirty = false,
  canSave = false,
  readOnly = false,
  onUpgrade,
  onCancel,
  onSave,
  onEnabledChange,
}: AccessControlStatusPanelProps) {
  const { t } = useTranslation()
  const appInfo = useAppStore((state) => state.appDetail)
  const [confirmPause, setConfirmPause] = useState(false)
  const selectedPolicy = policies.find((policy) => policy.id === draft.selectedPolicyId)
  const summary = selectedPolicy ? splitPolicySummary(selectedPolicy.allowed_cidrs) : undefined
  const coverage = getInServiceCoverage(draft.scopes)
  const labels: Record<AccessPoint, string> = {
    webApp: t(($) => $['overview.appInfo.title'], { ns: 'appOverview' }),
    serviceApi: t(($) => $['overview.apiInfo.title'], { ns: 'appOverview' }),
    mcp: t(($) => $['mcp.server.title'], { ns: 'tools' }),
    trigger: t(($) => $['settings.trigger'], { ns: 'common' }),
  }
  const exposedNames = ACCESS_POINT_ORDER.filter((scope) => draft.scopes[scope]).map(
    (scope) => labels[scope],
  )
  const policyName = selectedPolicy?.name

  return (
    <div className="flex w-100 flex-col">
      <div className="flex items-center justify-between gap-2 overflow-hidden px-4 pt-4 pb-3">
        <PopoverTitle className="min-w-0 flex-1 system-md-semibold text-text-primary">
          {policyName
            ? t(($) => $['studio.accessControl.restrictedTo'], {
                ns: 'deployments',
                name: policyName,
              })
            : t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })}
        </PopoverTitle>
        {readOnly ? (
          <Button type="button" variant="ghost" size="small" onClick={onUpgrade}>
            {t(($) => $['studio.accessControl.turnOn'], { ns: 'deployments' })}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="small" onClick={onEdit}>
            {t(($) => $['operation.edit'], { ns: 'common' })}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-5 overflow-hidden px-4 pt-2 pb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="system-md-medium text-text-primary">
              {t(($) => $['studio.accessControl.restrictByIp'], { ns: 'deployments' })}
            </p>
            <p className="system-xs-regular text-text-tertiary">
              {coverage.inServiceCount > 0 && coverage.coveredCount === coverage.inServiceCount
                ? t(($) => $['studio.accessControl.protectingAll'], {
                    ns: 'deployments',
                    count: coverage.inServiceCount,
                  })
                : t(($) => $['studio.accessControl.protectingPartial'], {
                    ns: 'deployments',
                    n: coverage.coveredCount,
                    m: coverage.inServiceCount,
                  })}
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={updating || readOnly}
            aria-label={t(($) => $['studio.accessControl.restrictByIp'], { ns: 'deployments' })}
            onCheckedChange={(next) => {
              if (next) {
                onEnabledChange(true)
                return
              }
              setConfirmPause(true)
            }}
          />
        </div>

        {selectedPolicy && summary && (
          <div className="flex flex-col gap-0.5">
            <p className="system-sm-medium text-text-secondary">
              {t(($) => $['studio.accessControl.ipPolicy'], { ns: 'deployments' })}
            </p>
            <p className="system-sm-regular text-text-primary">{selectedPolicy.name}</p>
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
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          <p className="system-sm-medium text-text-secondary">
            {t(($) => $['studio.accessControl.applyTo'], { ns: 'deployments' })}
          </p>
          {ACCESS_POINT_ORDER.map((scope) => {
            const excluded = !draft.scopes[scope]
            const label = labels[scope]

            return (
              <div key={scope} className="flex items-center gap-2 py-2">
                {scope === 'webApp' ? (
                  <AppIcon
                    size="tiny"
                    decorative
                    iconType={appInfo?.icon_type}
                    icon={appInfo?.icon}
                    background={appInfo?.icon_background ?? undefined}
                    imageUrl={appInfo?.icon_url}
                    className="rounded-sm bg-util-colors-orange-orange-100"
                  />
                ) : (
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-sm border-[0.5px] border-divider-regular bg-components-panel-bg',
                      excluded && 'opacity-40',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(SCOPE_ICONS[scope], 'size-3.5 text-text-tertiary')}
                    />
                  </span>
                )}
                <span
                  className={cn(
                    'system-sm-medium',
                    excluded ? 'shrink-0 text-text-tertiary' : 'min-w-0 flex-1 text-text-secondary',
                  )}
                >
                  {label}
                </span>
                {excluded && (
                  <span className="min-w-0 flex-1 text-right system-xs-regular text-text-quaternary">
                    {t(($) => $['studio.accessControl.excluded'], { ns: 'deployments' })}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {dirty && !readOnly && (
          <div className="flex items-center justify-end gap-2 pt-5">
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canSave || updating}
              loading={updating}
              onClick={onSave}
            >
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmPause} onOpenChange={setConfirmPause}>
        <AlertDialogContent className="w-100">
          <div className="flex flex-col gap-2 p-6 pb-4">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {t(($) => $['studio.accessControl.turnOffTitle'], { ns: 'deployments' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-secondary">
              {t(($) => $['studio.accessControl.turnOffDescription'], {
                ns: 'deployments',
                points: exposedNames.join(', '),
              })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary">
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              onClick={() => {
                onEnabledChange(false)
                setConfirmPause(false)
              }}
            >
              {t(($) => $['studio.accessControl.turnOffConfirm'], { ns: 'deployments' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
