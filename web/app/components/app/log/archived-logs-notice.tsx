'use client'

import { useTranslation } from 'react-i18next'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { IS_CLOUD_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useModalContextSelector } from '@/context/modal-context'

export function ArchivedLogsNotice() {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const setShowAccountSettingModal = useModalContextSelector(state => state.setShowAccountSettingModal)

  if (!IS_CLOUD_EDITION || !isCurrentWorkspaceManager)
    return null

  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 px-3 py-2">
      <span aria-hidden className="mt-0.5 i-ri-information-line size-4 shrink-0 text-util-colors-warning-warning-600" />
      <div className="min-w-0 flex-1 system-xs-regular text-util-colors-warning-warning-700">
        {t('archives.notice.description', { ns: 'appLog' })}
        <button
          type="button"
          className="ml-1 system-xs-semibold text-util-colors-warning-warning-700 underline underline-offset-2 hover:text-text-primary"
          onClick={() => setShowAccountSettingModal({
            payload: ACCOUNT_SETTING_TAB.WORKFLOW_LOG_ARCHIVES,
          })}
        >
          {t('archives.notice.action', { ns: 'appLog' })}
        </button>
      </div>
    </div>
  )
}
