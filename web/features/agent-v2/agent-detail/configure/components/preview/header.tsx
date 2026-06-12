'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export function AgentPreviewHeader({
  isChatFeaturesOpen,
  onToggleChatFeatures,
  onRestart,
}: {
  isChatFeaturesOpen: boolean
  onToggleChatFeatures: () => void
  onRestart: () => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 py-3 pr-3 pl-6">
      <h2 className="min-w-0 flex-1 truncate title-xl-semi-bold text-text-primary">
        {t('agentDetail.configure.preview.title')}
      </h2>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onRestart}
          className="flex size-6 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          aria-label={t('agentDetail.configure.preview.restart')}
        >
          <span aria-hidden className="i-custom-vender-other-replay-line size-4" />
        </button>
        <button
          type="button"
          aria-pressed={isChatFeaturesOpen}
          onClick={onToggleChatFeatures}
          className={cn(
            'flex h-8 items-center justify-center gap-0.5 rounded-lg px-3 py-2 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
            isChatFeaturesOpen && 'bg-state-base-hover text-text-secondary',
          )}
          aria-label={t('agentDetail.configure.preview.chatFeatures')}
        >
          <span aria-hidden className="i-ri-apps-2-add-line size-4" />
          <span className="px-0.5 system-sm-medium">{t('agentDetail.configure.preview.chatFeatures')}</span>
        </button>
      </div>
    </div>
  )
}
