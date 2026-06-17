'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { useClipboard } from 'foxact/use-clipboard'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { workflowAccessRows } from './mock-data'

type AgentAccessPageProps = {
  agentId: string
}

const serviceApiEndpoint = 'https://api.dify.ai/v1'

type AccessSurfaceCardProps = {
  title: string
  icon: string
  iconClassName: string
  endpointLabel: string
  endpoint: string
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  copyLabel: string
  children: ReactNode
  badge?: ReactNode
  onUnavailableAction: () => void
}

export function AgentAccessPage({
  agentId,
}: AgentAccessPageProps) {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()
  const [isWebAppEnabled, setIsWebAppEnabled] = useState(true)
  const [isServiceApiEnabled, setIsServiceApiEnabled] = useState(true)
  const webAppUrl = `https://udify.app/workflow/${agentId}`
  const handleUnavailableAction = () => {
    toast.info(t('agentDetail.access.actionUnavailable'))
  }

  return (
    <section
      aria-label={t('agentDetail.sections.access')}
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-components-panel-bg-blur"
    >
      <header className="h-15.5 shrink-0 px-6 pt-3 pb-2">
        <div className="min-w-0">
          <h2 className="system-xl-semibold text-text-primary">
            {t('agentDetail.access.title')}
          </h2>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-0.5 system-xs-regular text-text-tertiary">
            <span>{t('agentDetail.access.description')}</span>
            <a
              href={docLink('/use-dify/publish/webapp/web-app-access')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              {t('agentDetail.access.learnMore')}
              <span aria-hidden className="i-ri-external-link-line size-3" />
            </a>
          </p>
        </div>
      </header>

      <ScrollArea
        className="min-h-0 flex-1 overflow-hidden"
        slotClassNames={{
          content: 'px-6 pt-2 pb-8',
        }}
      >
        <div className="w-full min-w-0 space-y-6">
          <div className="grid w-full grid-cols-1 gap-3 xl:grid-cols-2">
            <AccessSurfaceCard
              title={t('agentDetail.access.webApp.title')}
              icon="i-ri-window-line"
              iconClassName="bg-state-accent-solid text-text-primary-on-surface"
              endpointLabel={t('agentDetail.access.webApp.accessUrl')}
              endpoint={webAppUrl}
              enabled={isWebAppEnabled}
              onEnabledChange={setIsWebAppEnabled}
              copyLabel={t('agentDetail.access.copyAccessUrl')}
              badge={<SsoBadge />}
              onUnavailableAction={handleUnavailableAction}
            >
              <Button
                variant="secondary"
                size="medium"
                nativeButton={false}
                className="gap-1.5 px-3"
                render={<a href={webAppUrl} target="_blank" rel="noreferrer" aria-label={t('agentDetail.access.webApp.actions.launch')} />}
              >
                <span aria-hidden className="i-ri-external-link-line size-4" />
                {t('agentDetail.access.webApp.actions.launch')}
              </Button>
              <Button variant="secondary" size="medium" className="gap-1.5 px-3" onClick={handleUnavailableAction}>
                <span aria-hidden className="i-ri-window-line size-4" />
                {t('agentDetail.access.webApp.actions.embedded')}
              </Button>
              <Button variant="secondary" size="medium" className="gap-1.5 px-3" onClick={handleUnavailableAction}>
                <span aria-hidden className="i-ri-paint-brush-line size-4" />
                {t('agentDetail.access.webApp.actions.customize')}
              </Button>
              <Button variant="secondary" size="medium" className="gap-1.5 px-3" onClick={handleUnavailableAction}>
                <span aria-hidden className="i-ri-equalizer-line size-4" />
                {t('agentDetail.access.webApp.actions.settings')}
              </Button>
            </AccessSurfaceCard>

            <AccessSurfaceCard
              title={t('agentDetail.access.serviceApi.title')}
              icon="i-ri-node-tree"
              iconClassName="bg-state-accent-solid text-text-primary-on-surface"
              endpointLabel={t('agentDetail.access.serviceApi.endpoint')}
              endpoint={serviceApiEndpoint}
              enabled={isServiceApiEnabled}
              onEnabledChange={setIsServiceApiEnabled}
              copyLabel={t('agentDetail.access.copyServiceEndpoint')}
              onUnavailableAction={handleUnavailableAction}
            >
              <Button variant="secondary" size="medium" className="gap-1.5 px-3" onClick={handleUnavailableAction}>
                <span aria-hidden className="i-ri-key-2-line size-4" />
                {t('agentDetail.access.serviceApi.actions.apiKey')}
                <span className="rounded-md bg-components-badge-bg-gray-soft px-1.5 code-xs-regular text-text-tertiary">
                  21
                </span>
              </Button>
              <Button
                variant="secondary"
                size="medium"
                nativeButton={false}
                className="gap-1.5 px-3"
                render={<a href={docLink('/use-dify/publish/developing-with-apis')} target="_blank" rel="noreferrer" aria-label={t('agentDetail.access.serviceApi.actions.apiReference')} />}
              >
                <span aria-hidden className="i-ri-book-open-line size-4" />
                {t('agentDetail.access.serviceApi.actions.apiReference')}
              </Button>
            </AccessSurfaceCard>
          </div>

          <section aria-labelledby="agent-workflow-access-title">
            <div className="mb-3">
              <h3 id="agent-workflow-access-title" className="system-md-semibold text-text-primary">
                {t('agentDetail.access.workflow.title')}
              </h3>
              <p className="mt-0.5 system-xs-regular text-text-tertiary">
                {t('agentDetail.access.workflow.description')}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1212px] table-fixed border-collapse">
                <colgroup>
                  <col className="w-[628px]" />
                  <col className="w-60" />
                  <col className="w-[200px]" />
                  <col className="w-36" />
                </colgroup>
                <thead>
                  <tr className="h-7 rounded-lg bg-background-section-burn text-left system-xs-semibold-uppercase text-text-tertiary">
                    <th scope="col" className="rounded-l-lg px-3 font-semibold">
                      {t('agentDetail.access.workflow.table.name')}
                    </th>
                    <th scope="col" className="px-3 font-semibold">
                      {t('agentDetail.access.workflow.table.createdBy')}
                    </th>
                    <th scope="col" className="px-3 font-semibold">
                      {t('agentDetail.access.workflow.table.lastUsed')}
                    </th>
                    <th scope="col" className="rounded-r-lg px-3 font-semibold">
                      {t('agentDetail.access.workflow.table.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="system-sm-regular text-text-secondary">
                  {workflowAccessRows.map(row => (
                    <tr key={row.id} className="h-10 border-b border-divider-subtle hover:bg-background-default-hover">
                      <td className="px-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border border-divider-subtle', row.iconClassName)}>
                            <span aria-hidden className={cn(row.icon, 'size-3.5')} />
                          </span>
                          <span className="truncate">
                            {row.name}
                          </span>
                        </div>
                      </td>
                      <td className="truncate px-3">
                        {row.createdBy}
                      </td>
                      <td className="px-3 tabular-nums" translate="no">
                        {row.lastUsed}
                      </td>
                      <td className="px-3">
                        <a
                          href={row.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 rounded-sm text-text-secondary hover:text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                        >
                          {t('agentDetail.access.workflow.openInStudio')}
                          <span aria-hidden className="i-ri-external-link-line size-4" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </ScrollArea>
    </section>
  )
}

function AccessSurfaceCard({
  title,
  icon,
  iconClassName,
  endpointLabel,
  endpoint,
  enabled,
  onEnabledChange,
  copyLabel,
  children,
  badge,
  onUnavailableAction,
}: AccessSurfaceCardProps) {
  const { t } = useTranslation('agentV2')
  const { copy } = useClipboard({
    onCopyError: () => {
      toast.error(t('agentDetail.access.copyFailed'))
    },
  })

  const handleCopyEndpoint = () => {
    void copy(endpoint)
  }

  return (
    <article className="overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xs">
      <div className="px-4 pt-4 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-lg', iconClassName)}>
              <span aria-hidden className={cn(icon, 'size-4')} />
            </span>
            <h3 className="truncate system-md-semibold text-text-secondary">
              {title}
            </h3>
            {badge}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span className={cn(
              'inline-flex items-center gap-1 system-xs-semibold-uppercase',
              enabled ? 'text-util-colors-green-green-700' : 'text-text-tertiary',
            )}
            >
              <StatusDot status={enabled ? 'success' : 'disabled'} size="small" />
              {t(enabled ? 'agentDetail.access.status.inService' : 'agentDetail.access.status.outOfService')}
            </span>
            <Switch
              size="md"
              checked={enabled}
              aria-label={t('agentDetail.access.toggleSurface', { name: title })}
              onCheckedChange={onEnabledChange}
            />
          </div>
        </div>

        <div className="mt-3">
          <div className="system-xs-medium text-text-tertiary">
            {endpointLabel}
          </div>
          <div className="mt-1 flex h-8 min-w-0 items-center rounded-lg bg-components-input-bg-normal px-2">
            <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary" translate="no">
              {endpoint}
            </span>
            <Button
              variant="ghost"
              size="small"
              className="size-6 shrink-0 px-0 text-text-tertiary hover:text-text-secondary"
              aria-label={copyLabel}
              onClick={handleCopyEndpoint}
            >
              <span aria-hidden className="i-ri-file-copy-line size-4" />
            </Button>
            {badge !== undefined && badge !== null && (
              <>
                <span className="mx-1.5 h-3.5 w-px shrink-0 bg-divider-regular" />
                <Button
                  variant="ghost"
                  size="small"
                  className="size-6 shrink-0 px-0 text-text-tertiary hover:text-text-secondary"
                  aria-label={t('agentDetail.access.webApp.showQrCode')}
                  onClick={onUnavailableAction}
                >
                  <span aria-hidden className="i-ri-qr-code-line size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  className="size-6 shrink-0 px-0 text-text-tertiary hover:text-text-secondary"
                  aria-label={t('agentDetail.access.webApp.refreshUrl')}
                  onClick={onUnavailableAction}
                >
                  <span aria-hidden className="i-ri-refresh-line size-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-16 flex-wrap items-center gap-2 border-t border-divider-subtle px-4 py-4">
        {children}
      </div>
    </article>
  )
}

function SsoBadge() {
  const { t } = useTranslation('agentV2')

  return (
    <span className="inline-flex h-4.5 shrink-0 items-center gap-1 rounded-sm border border-divider-deep px-1.5 system-2xs-semibold-uppercase text-text-tertiary">
      <span aria-hidden className="i-ri-shield-check-line size-3" />
      {t('agentDetail.access.webApp.ssoEnabled')}
    </span>
  )
}
