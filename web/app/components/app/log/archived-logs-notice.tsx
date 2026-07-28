'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContextSelector } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'

export function ArchivedLogsNotice() {
  const { t } = useTranslation()
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const { enableBilling, plan } = useProviderContext()
  const setShowAccountSettingModal = useModalContextSelector(
    (state) => state.setShowAccountSettingModal,
  )

  if (
    deploymentEdition !== 'CLOUD' ||
    !isCurrentWorkspaceManager ||
    !enableBilling ||
    plan.type === Plan.sandbox
  )
    return null

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
          className="i-ri-information-2-fill size-5 shrink-0 text-text-accent"
        />
        <p className="min-w-0 flex-1 system-sm-semibold wrap-break-word text-text-primary">
          {t(($) => $['archives.notice.description'], { ns: 'appLog' })}
        </p>
        <Button
          variant="primary"
          className="shrink-0"
          onClick={() =>
            setShowAccountSettingModal({
              payload: ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES,
            })
          }
        >
          {t(($) => $['archives.notice.action'], { ns: 'appLog' })}
        </Button>
      </div>
    </div>
  )
}
