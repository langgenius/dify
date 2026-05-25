'use client'

import type { Environment } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { Switch, SwitchSkeleton } from '@langgenius/dify-ui/switch'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { environmentName } from '../../../environment'
import { webappUrl } from '../../../webapp-url'
import { Section, SectionState } from '../../common'
import { CopyPill, EndpointRow } from './common'
import { getUrlOrigin } from './url'

const ACCESS_CHANNEL_SKELETON_SECTIONS = [
  { key: 'webapp' },
  { key: 'cli' },
]

function AccessChannelsSwitch({ appInstanceId, checked, disabled }: {
  appInstanceId: string
  checked: boolean
  disabled?: boolean
}) {
  const toggleAccessChannel = useMutation(consoleQuery.enterprise.accessService.updateAccessChannels.mutationOptions())

  return (
    <Switch
      checked={checked}
      disabled={disabled}
      loading={toggleAccessChannel.isPending}
      onCheckedChange={(enabled) => {
        toggleAccessChannel.mutate({
          params: { appInstanceId },
          body: { appInstanceId, webAppEnabled: enabled },
        })
      }}
    />
  )
}

function AccessChannelsSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-divider-subtle bg-components-panel-bg">
      {ACCESS_CHANNEL_SKELETON_SECTIONS.map(section => (
        <SkeletonRow
          key={section.key}
          className="flex flex-col gap-3 border-t border-divider-subtle px-4 py-4 first:border-t-0 lg:flex-row lg:items-start"
        >
          <div className="flex min-w-0 gap-2.5 lg:w-70">
            <SkeletonRectangle className="my-0 size-7 shrink-0 animate-pulse rounded-lg" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <SkeletonRectangle className="h-3.5 w-24 animate-pulse" />
              <SkeletonRectangle className="h-3 w-40 animate-pulse" />
            </div>
          </div>
          <SkeletonRectangle className="my-0 h-8 min-w-0 flex-1 animate-pulse rounded-lg" />
        </SkeletonRow>
      ))}
    </div>
  )
}

function ChannelInfo({ icon, title, description }: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-background-section-burn text-text-tertiary">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="system-sm-medium text-text-primary">{title}</span>
        </div>
        <div className="system-xs-regular text-text-tertiary">{description}</div>
      </div>
    </div>
  )
}

function ChannelRow({ info, children }: {
  info: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-divider-subtle px-4 py-4 first:border-t-0 lg:flex-row lg:items-start">
      <div className="min-w-0 lg:w-70">
        {info}
      </div>
      <div className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  )
}

function ChannelEmptyState({ children }: {
  children: ReactNode
}) {
  return (
    <div className="flex min-h-8 items-center rounded-lg bg-background-default-subtle px-3 system-xs-regular text-text-tertiary">
      <span className="mr-1.5 i-ri-information-line size-3.5 shrink-0 text-text-quaternary" aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  )
}

export function AccessChannelsSection({
  appInstanceId,
}: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const accessChannelsQuery = useQuery(consoleQuery.enterprise.accessService.getAccessChannels.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const environmentDeploymentsQuery = useQuery(consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const accessChannels = accessChannelsQuery.data?.accessChannels
  const runEnabled = accessChannels?.webAppEnabled ?? false
  const webappRows = environmentDeploymentsQuery.data?.data
    ?.map(row => row.environment)
    .filter((environment): environment is Environment & { id: string, runtimeEndpoint: string } => Boolean(environment?.id && environment.runtimeEndpoint)) ?? []
  const cliDomain = getUrlOrigin(webappRows[0]?.runtimeEndpoint)
  const cliDocsUrl = cliDomain ? `${cliDomain}/cli` : undefined
  const isLoading = accessChannelsQuery.isLoading || (runEnabled && environmentDeploymentsQuery.isLoading)
  const isError = accessChannelsQuery.isError || (runEnabled && environmentDeploymentsQuery.isError)

  return (
    <Section
      title={t('access.channels.title')}
      description={t('access.channels.description')}
      action={(
        isLoading
          ? <SwitchSkeleton />
          : (
              <AccessChannelsSwitch
                appInstanceId={appInstanceId}
                checked={runEnabled}
                disabled={isError}
              />
            )
      )}
    >
      {isLoading
        ? <AccessChannelsSkeleton />
        : isError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : runEnabled
            ? (
                <div className="overflow-hidden rounded-lg border border-divider-subtle bg-components-panel-bg">
                  <ChannelRow
                    info={(
                      <ChannelInfo
                        icon={<span className="i-ri-global-line size-3.5" aria-hidden="true" />}
                        title={t('access.runAccess.webapp')}
                        description={t('access.runAccess.webappDesc')}
                      />
                    )}
                  >
                    {webappRows.length > 0
                      ? (
                          <div className="flex flex-col gap-1.5">
                            {webappRows.map((environment) => {
                              const endpointUrl = webappUrl(environment.runtimeEndpoint ?? '')

                              return (
                                <EndpointRow
                                  key={`webapp-${environment.id ?? environment.runtimeEndpoint}`}
                                  envName={environmentName(environment)}
                                  label={t('access.runAccess.urlLabel')}
                                  value={endpointUrl}
                                  openLabel={t('access.runAccess.openWebapp')}
                                />
                              )
                            })}
                          </div>
                        )
                      : (
                          <ChannelEmptyState>
                            {t('access.runAccess.webappEmpty')}
                          </ChannelEmptyState>
                        )}
                  </ChannelRow>
                  <ChannelRow
                    info={(
                      <ChannelInfo
                        icon={<span className="i-ri-terminal-box-line size-3.5" aria-hidden="true" />}
                        title={t('access.cli.title')}
                        description={t('access.cli.description')}
                      />
                    )}
                  >
                    {cliDomain
                      ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <CopyPill
                              label={t('access.cli.domain')}
                              value={cliDomain}
                              className="min-w-0 flex-1"
                            />
                            <a
                              href={cliDocsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover"
                            >
                              <span className="i-ri-download-cloud-2-line size-3.5" />
                              {t('access.cli.install')}
                            </a>
                            <a
                              href={cliDocsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover"
                            >
                              <span className="i-ri-book-open-line size-3.5" />
                              {t('access.cli.docs')}
                            </a>
                          </div>
                        )
                      : (
                          <ChannelEmptyState>
                            {t('access.cli.empty')}
                          </ChannelEmptyState>
                        )}
                  </ChannelRow>
                </div>
              )
            : (
                <div className="system-xs-regular text-text-tertiary">
                  {t('access.channels.disabled')}
                </div>
              )}
    </Section>
  )
}
