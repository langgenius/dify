'use client'

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
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 px-3 py-2">
      <span
        aria-hidden
        className="mt-0.5 i-ri-information-line size-4 shrink-0 text-util-colors-warning-warning-600"
      />
      <div className="min-w-0 flex-1 system-xs-regular text-util-colors-warning-warning-700">
        {t(($) => $['archives.notice.description'], { ns: 'appLog' })}
        <button
          type="button"
          className="ml-1 system-xs-semibold text-util-colors-warning-warning-700 underline underline-offset-2 hover:text-text-primary"
          onClick={() =>
            setShowAccountSettingModal({
              payload: ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES,
            })
          }
        >
          {t(($) => $['archives.notice.action'], { ns: 'appLog' })}
        </button>
      </div>
    </div>
  )
}
