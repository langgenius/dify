'use client'

import type { AccessControlDraft, AccessControlPolicy } from './draft'
import type { AccessControlAppIcon } from './index'
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
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { PopoverTitle } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  appIcon: AccessControlAppIcon
  availableAccessPoints: readonly AccessPoint[]
  policies: readonly AccessControlPolicy[]
  enabled: boolean
  onEdit: () => void
  updating?: boolean
  readOnly?: boolean
  onEnabledChange: (enabled: boolean) => void
}

export function AccessControlStatusPanel({
  draft,
  appIcon,
  availableAccessPoints,
  policies,
  enabled,
  onEdit,
  updating = false,
  readOnly = false,
  onEnabledChange,
}: AccessControlStatusPanelProps) {
  const { t } = useTranslation()
  const [confirmPause, setConfirmPause] = useState(false)
  const selectedPolicy = policies.find((policy) => policy.id === draft.selectedPolicyId)
  const summary = selectedPolicy ? splitPolicySummary(selectedPolicy.allowed_cidrs) : undefined
  const coverage = getInServiceCoverage(draft.scopes, availableAccessPoints)
  const labels: Record<AccessPoint, string> = {
    webApp: t(($) => $['overview.appInfo.title'], { ns: 'appOverview' }),
    serviceApi: t(($) => $['overview.apiInfo.title'], { ns: 'appOverview' }),
    mcp: t(($) => $['mcp.server.title'], { ns: 'tools' }),
    trigger: t(($) => $['settings.trigger'], { ns: 'common' }),
  }
  const policyName = selectedPolicy?.name

  return (
    <div className="flex w-100 flex-col">
      <div className="flex items-center justify-between gap-2 overflow-hidden px-4 pt-4 pb-3">
        <PopoverTitle className="min-w-0 flex-1 system-md-semibold text-text-primary">
          {policyName && enabled
            ? t(($) => $['studio.accessControl.restrictedTo'], {
                ns: 'deployments',
                name: policyName,
              })
            : t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })}
        </PopoverTitle>
        {!readOnly && (
          <Button type="button" variant="ghost" size="small" disabled={updating} onClick={onEdit}>
            {t(($) => $['operation.edit'], { ns: 'common' })}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-5 overflow-hidden px-4 pt-2 pb-4">
        <Field className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FieldLabel className="system-md-medium text-text-primary">
              {t(($) => $['studio.accessControl.restrictByIp'], { ns: 'deployments' })}
            </FieldLabel>
            <p className="system-xs-regular text-text-tertiary">
              {!enabled
                ? t(($) => $['studio.accessControl.tooltipPaused'], {
                    ns: 'deployments',
                    name: policyName ?? '',
                  })
                : coverage.inServiceCount > 0 && coverage.coveredCount === coverage.inServiceCount
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
            onCheckedChange={(next) => {
              if (readOnly || updating) return
              if (next) {
                onEnabledChange(true)
                return
              }
              setConfirmPause(true)
            }}
          />
        </Field>

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
          {availableAccessPoints.map((scope) => {
            const excluded = !draft.scopes[scope]
            const label = labels[scope]

            return (
              <div key={scope} className="flex items-center gap-2 py-2">
                {scope === 'webApp' ? (
                  <AppIcon
                    size="tiny"
                    decorative
                    {...appIcon}
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
                    {t(($) => $['studio.accessControl.notEnabled'], { ns: 'deployments' })}
                  </span>
                )}
              </div>
            )
          })}
        </div>
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
              })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary">
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={readOnly || updating}
              onClick={() => {
                if (readOnly || updating) return
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
