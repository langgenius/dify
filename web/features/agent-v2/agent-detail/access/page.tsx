'use client'

import type { AgentAccessSource } from './access-sources'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { getAgentDetailPath } from '../routes'
import { agentAccessSources } from './access-sources'

type AgentAccessPageProps = {
  agentId: string
}

export function AgentAccessPage({
  agentId,
}: AgentAccessPageProps) {
  const { t } = useTranslation('agentV2')
  const router = useRouter()

  const navigateToSection = (section: 'logs' | 'monitoring') => {
    router.push(getAgentDetailPath(agentId, section))
  }

  return (
    <section
      aria-label={t('agentDetail.sections.access')}
      className="h-full min-w-0 flex-1 overflow-auto bg-components-panel-bg-blur px-4 py-6 sm:px-12"
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex items-start gap-4 border-b border-divider-subtle pb-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-state-accent-hover text-text-accent-light-mode-only">
            <span aria-hidden className="i-ri-share-forward-fill size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="system-xl-semibold text-text-primary">
              {t('agentDetail.access.title')}
            </h2>
            <p className="mt-1 system-sm-regular text-text-tertiary">
              {t('agentDetail.access.description')}
            </p>
          </div>
        </header>

        <section aria-labelledby="agent-access-webapp">
          <h3 id="agent-access-webapp" className="mb-2 system-sm-semibold-uppercase text-text-secondary">
            {t('agentDetail.access.groups.webapp.heading')}
          </h3>

          <div className="overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs">
            <div className="flex h-9 items-center border-b border-divider-subtle px-4">
              <span className="system-xs-semibold-uppercase text-text-secondary">
                {t('agentDetail.access.groups.webapp.label')}
              </span>
              <span className="ml-2 system-xs-regular text-text-tertiary">
                {t('agentDetail.access.entryCount', { count: agentAccessSources.length })}
              </span>
            </div>
            <div className="divide-y divide-divider-subtle">
              {agentAccessSources.map(source => (
                <AccessSourceRow
                  key={source.nameKey}
                  source={source}
                  onNavigateToLogs={() => navigateToSection('logs')}
                  onNavigateToMonitoring={() => navigateToSection('monitoring')}
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}

function AccessSourceRow({
  source,
  onNavigateToLogs,
  onNavigateToMonitoring,
}: {
  source: AgentAccessSource
  onNavigateToLogs: () => void
  onNavigateToMonitoring: () => void
}) {
  const { t } = useTranslation('agentV2')
  const name = t(source.nameKey)

  return (
    <article className="grid min-h-14 grid-cols-[minmax(0,1.1fr)_minmax(10rem,0.9fr)_auto_auto] items-center gap-3 px-4 py-3 max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:gap-y-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-state-accent-hover text-text-accent-light-mode-only">
          <span aria-hidden className={`${source.icon} size-4`} />
        </div>
        <div className="min-w-0">
          <h4 className="truncate system-sm-semibold text-text-primary">
            {name}
          </h4>
          <p className="truncate system-xs-regular text-text-tertiary">
            {t(source.descriptionKey)}
          </p>
        </div>
      </div>

      <div className="min-w-0 max-lg:col-start-1 max-lg:pl-11">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate code-xs-regular text-text-secondary" translate="no">
            {source.reference}
          </span>
          <button
            type="button"
            aria-label={t('agentDetail.access.copyReference', { name })}
            className="flex size-5 shrink-0 items-center justify-center rounded-md border border-divider-subtle bg-components-button-secondary-bg text-text-tertiary hover:bg-components-button-secondary-bg-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className={source.external ? 'i-ri-external-link-line size-3.5' : 'i-ri-file-copy-line size-3.5'} />
          </button>
        </div>
        <p className="mt-0.5 truncate system-xs-regular text-text-tertiary">
          {t(source.lastUsedKey)}
        </p>
      </div>

      <span className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border px-2 system-2xs-semibold-uppercase',
        source.status === 'enabled'
          ? 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700'
          : 'border-divider-deep bg-components-badge-bg-dimm text-text-tertiary',
      )}
      >
        <span className={cn(
          'size-1.5 rounded-full',
          source.status === 'enabled' ? 'bg-util-colors-green-green-600' : 'bg-text-quaternary',
        )}
        />
        {t(`agentDetail.access.status.${source.status}`)}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={(
            <Button
              variant="secondary"
              size="small"
              className="size-8 px-0"
              aria-label={t('agentDetail.access.moreActions', { name })}
            >
              <span aria-hidden className="i-ri-more-2-fill size-4" />
            </Button>
          )}
        />
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={6}
          popupClassName="w-61"
        >
          <DropdownMenuItem onClick={onNavigateToLogs}>
            {t('agentDetail.sections.logs')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onNavigateToMonitoring}>
            {t('agentDetail.access.actions.monitoring')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  )
}
