'use client'

import { useTranslation } from 'react-i18next'

export function AgentPreviewHeader() {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 py-3 pr-3 pl-6">
      <h2 className="min-w-0 flex-1 truncate title-xl-semi-bold text-text-primary">
        {t('agentDetail.configure.preview.title')}
      </h2>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          aria-label={t('agentDetail.configure.preview.restart')}
        >
          <span aria-hidden className="i-custom-vender-other-replay-line size-4" />
        </button>
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          aria-label={t('agentDetail.configure.preview.endUserAuth')}
        >
          <span aria-hidden className="i-ri-user-settings-line size-4" />
        </button>
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          aria-label={t('agentDetail.configure.preview.settings')}
        >
          <span aria-hidden className="i-ri-equalizer-2-line size-4" />
        </button>
      </div>
    </div>
  )
}
