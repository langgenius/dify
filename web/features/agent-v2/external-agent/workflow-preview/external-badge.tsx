import { useTranslation } from 'react-i18next'

export function ExternalAgentBadge() {
  const { t } = useTranslation(['agentRoster'])
  return (
    <span className="shrink-0 rounded-[5px] border border-divider-deep px-1.25 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
      {t(($) => $['roster.nodeSelector.source.external'])}
    </span>
  )
}
