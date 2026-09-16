'use client'

import type { AccessControlAssignment } from './chip-status'
import type { AccessPoint } from '@/app/components/app/deploy/utils/access-point'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { PopoverDescription, PopoverTitle } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import { useStore as useAppStore } from '@/app/components/app/store'
import AppIcon from '@/app/components/base/app-icon'
import { getInServiceCoverage } from './chip-status'

const SCOPE_ICONS: Record<Exclude<AccessPoint, 'webApp'>, string> = {
  serviceApi: 'i-custom-vender-knowledge-api-aggregate',
  mcp: 'i-custom-vender-integrations-mcp',
  trigger: 'i-custom-vender-integrations-trigger',
}

type AccessControlDowngradePanelProps = {
  assignment: AccessControlAssignment
  onTurnOn: () => void
}

export function AccessControlDowngradePanel({
  assignment,
  onTurnOn,
}: AccessControlDowngradePanelProps) {
  const { t } = useTranslation()
  const appInfo = useAppStore((state) => state.appDetail)
  const coverage = getInServiceCoverage(assignment.scopes)
  const protectedScopes = ACCESS_POINT_ORDER.filter((scope) => assignment.scopes[scope])
  const title = t(($) => $['studio.accessControl.entryLabel'], { ns: 'deployments' })
  const turnOn = t(($) => $['studio.accessControl.turnOn'], { ns: 'deployments' })
  const pro = t(($) => $['studio.accessControl.proBadge'], { ns: 'deployments' })

  return (
    <div className="flex w-100 flex-col">
      <div className="overflow-hidden border-b border-divider-subtle px-4 pt-4 pb-3">
        <PopoverTitle className="min-w-0 flex-1 system-md-semibold text-text-primary">
          {title}
        </PopoverTitle>
      </div>
      <div className="flex flex-col gap-4 overflow-hidden px-4 pt-2 pb-4">
        <div className="flex flex-col gap-1">
          <p className="system-md-semibold text-text-warning">
            {t(($) => $['studio.accessControl.downgradeTitle'], { ns: 'deployments' })}
          </p>
          <PopoverDescription className="system-xs-regular text-text-tertiary">
            {t(($) => $['studio.accessControl.downgradeDescription'], { ns: 'deployments' })}
          </PopoverDescription>
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-background-section-burn p-3">
          <div className="flex flex-col gap-1.5">
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['studio.accessControl.readyToResume'], { ns: 'deployments' })}
            </p>
            <p className="system-sm-medium text-text-primary">{assignment.policyName}</p>
            <div className="flex items-center gap-2">
              <div className="flex items-start gap-1">
                {protectedScopes.map((scope) =>
                  scope === 'webApp' ? (
                    <AppIcon
                      key={scope}
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
                      key={scope}
                      className="flex size-6 shrink-0 items-center justify-center rounded-sm border-[0.5px] border-divider-regular bg-components-panel-bg"
                    >
                      <span
                        aria-hidden
                        className={cn(SCOPE_ICONS[scope], 'size-3.5 text-text-tertiary')}
                      />
                    </span>
                  ),
                )}
              </div>
              <p className="min-w-0 flex-1 system-xs-regular text-text-tertiary">
                {t(($) => $['studio.accessControl.protectsCoverage'], {
                  ns: 'deployments',
                  n: coverage.coveredCount,
                  m: coverage.inServiceCount,
                })}
              </p>
            </div>
          </div>
          <div className="relative">
            <Button variant="primary" className="w-full" onClick={onTurnOn}>
              {turnOn}
            </Button>
            <span
              aria-hidden
              className="pointer-events-none absolute top-1.75 right-2 inline-flex h-[18px] items-center gap-px overflow-hidden rounded-[5px] border-[0.5px] border-components-premium-badge-blue-stroke-stop-0 px-1 py-[3px] shadow-xs"
              style={{
                backgroundImage:
                  'linear-gradient(101.6deg, var(--color-components-premium-badge-blue-stroke-stop-0) 0%, var(--color-components-premium-badge-blue-text-stop-0) 105.58%), linear-gradient(90deg, #a0bdff, #a0bdff)',
              }}
            >
              <span className="i-custom-public-common-sparkles-soft-accent flex size-3 items-center py-px pl-px" />
              <span className="px-0.5 system-2xs-medium text-text-accent-light-mode-only">
                {pro}
              </span>
              <span className="absolute top-0 right-1/2 i-custom-public-common-highlight h-4.5 w-12 translate-x-[20%] opacity-50" />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
