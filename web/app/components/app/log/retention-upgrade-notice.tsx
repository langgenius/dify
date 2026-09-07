'use client'

import { useTranslation } from 'react-i18next'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { useCloudSandboxPlanStatus } from './cloud-sandbox-retention'

export function RetentionUpgradeNotice() {
  const { t } = useTranslation()
  const planState = useCloudSandboxPlanStatus()

  if (planState !== 'sandbox') return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="relative mb-3 shrink-0 overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]"
    >
      <div
        aria-hidden="true"
        className="absolute -inset-px bg-linear-to-r from-components-badge-status-light-normal-halo to-background-gradient-mask-transparent opacity-40"
      />
      <div className="relative flex items-center gap-3 px-3 py-2">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-components-button-primary-bg"
        >
          <span className="i-ri-file-list-3-fill size-4 text-components-button-primary-text" />
        </span>
        <p className="min-w-0 flex-1 system-sm-medium wrap-break-word text-text-primary">
          {t(($) => $['retention.upgradeTip.description'], { ns: 'appLog' })}
        </p>
        <UpgradeBtn
          isShort
          size="custom"
          className="h-8! shrink-0 rounded-lg! px-2"
          loc="logs-retention"
        />
      </div>
    </div>
  )
}
