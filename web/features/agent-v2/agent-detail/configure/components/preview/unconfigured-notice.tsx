'use client'

import { useTranslation } from 'react-i18next'

export function AgentUnconfiguredNotice({ visible }: { visible: boolean }) {
  const { t } = useTranslation('agentV2')

  return (
    <p
      aria-hidden={!visible}
      className="mt-1 flex max-w-full items-start gap-1 body-md-regular text-text-tertiary"
      style={{ visibility: visible ? 'visible' : 'hidden' }}
    >
      <span
        aria-hidden
        className="mt-0.5 i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary"
      />
      <span className="min-w-0">
        {t(($) => $['agentDetail.configure.preview.unconfiguredNotice'])}
      </span>
    </p>
  )
}
