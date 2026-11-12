import type { ExternalAgentOverviewPreview } from '../preview'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

export function ExternalAgentIdentity({
  agent,
  heading: Heading = 'h1',
}: {
  agent: ExternalAgentOverviewPreview['agent']
  heading?: 'h1' | 'h2'
}) {
  const { t } = useTranslation(['agentRoster'])
  return (
    <>
      <AppIcon
        icon={agent.icon}
        size="xl"
        fallback={{
          content: <span aria-hidden className="i-ri-robot-2-line size-7 text-text-tertiary" />,
          background: 'var(--color-components-icon-bg-midnight-soft)',
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Heading className="title-2xl-semi-bold font-bold wrap-break-word text-text-primary">
            {agent.name}
          </Heading>
          <span
            className={cn(
              'rounded-md border px-1.25 py-0.5 system-xs-medium',
              agent.enabled
                ? 'border-text-success text-text-success'
                : 'border-divider-deep text-text-tertiary',
            )}
          >
            {agent.enabled
              ? t(($) => $['external.filters.enabled'])
              : t(($) => $['external.filters.disabled'])}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 system-sm-regular">
          <span className="text-text-tertiary">{t(($) => $['external.overview.type'])}</span>
          {agent.role && (
            <>
              <span aria-hidden className="h-3 w-px bg-divider-deep" />
              <span className="wrap-break-word text-text-secondary">{agent.role}</span>
            </>
          )}
        </div>
      </div>
    </>
  )
}
