'use client'

import { useTranslation } from 'react-i18next'

type AgentOrchestrateHeaderProps = {
  headingId: string
}

export function AgentOrchestrateHeader({
  headingId,
}: AgentOrchestrateHeaderProps) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="flex shrink-0 items-center gap-1 px-4 py-2">
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h2 id={headingId} className="truncate title-xl-semi-bold text-text-primary">
          {t('agentDetail.configure.orchestrate')}
        </h2>
      </div>
    </div>
  )
}
