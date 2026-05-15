'use client'

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
  { key: 'webapp', className: 'flex flex-col gap-2' },
  { key: 'cli', className: 'flex flex-col gap-2 border-t border-divider-subtle pt-3' },
]

function AccessChannelsSwitch({ appInstanceId, checked, disabled }: {
  appInstanceId: string
  checked: boolean
  disabled?: boolean
}) {
  const toggleAccessChannel = useMutation(consoleQuery.enterprise.appDeployAccessService.updateAccessChannels.mutationOptions())

  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={(enabled) => {
        toggleAccessChannel.mutate({
          params: { appInstanceId },
          body: { appInstanceId, enabled },
        })
      }}
    />
  )
}

function AccessChannelsSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {ACCESS_CHANNEL_SKELETON_SECTIONS.map(section => (
        <div
          key={section.key}
          className={section.className}
        >
          <SkeletonRow className="items-center gap-2">
            <SkeletonRectangle className="h-3.5 w-24 animate-pulse" />
            <SkeletonRectangle className="my-0 h-5 w-24 animate-pulse rounded-full" />
          </SkeletonRow>
          <SkeletonRectangle className="h-3 w-2/3 animate-pulse" />
          <SkeletonRow className="flex-wrap items-center gap-x-3 gap-y-1.5">
            <SkeletonRectangle className="h-3 w-35 animate-pulse" />
            <SkeletonRectangle className="my-0 h-8 min-w-65 flex-1 animate-pulse rounded-lg" />
            <SkeletonRectangle className="my-0 h-8 w-24 animate-pulse rounded-lg" />
          </SkeletonRow>
        </div>
      ))}
    </div>
  )
}

export function AccessChannelsSection({
  appInstanceId,
}: {
  appInstanceId: string
}) {
  const { t } = useTranslation('deployments')
  const accessConfigQuery = useQuery(consoleQuery.enterprise.appDeployAccessService.getAppInstanceAccess.queryOptions({
    input: {
      params: { appInstanceId },
    },
  }))
  const accessConfig = accessConfigQuery.data
  const runEnabled = accessConfig?.accessChannels?.enabled ?? false
  const webappRows = accessConfig?.accessChannels?.webappRows?.filter(row => row.url) ?? []
  const cliDomain = getUrlOrigin(accessConfig?.accessChannels?.cli?.url)
  const cliDocsUrl = cliDomain ? `${cliDomain}/cli` : undefined

  return (
    <Section
      title={t('access.channels.title')}
      description={t('access.channels.description')}
      layout="row"
      action={(
        accessConfigQuery.isLoading
          ? <SwitchSkeleton />
          : (
              <AccessChannelsSwitch
                appInstanceId={appInstanceId}
                checked={runEnabled}
                disabled={accessConfigQuery.isError}
              />
            )
      )}
    >
      {accessConfigQuery.isLoading
        ? <AccessChannelsSkeleton />
        : accessConfigQuery.isError
          ? <SectionState>{t('common.loadFailed')}</SectionState>
          : runEnabled
            ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3.5">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <div className="system-sm-medium text-text-primary">
                          {t('access.runAccess.webapp')}
                        </div>
                        <span className="inline-flex h-5 items-center rounded-full bg-state-success-hover px-1.5 system-2xs-medium text-state-success-solid">
                          {t('access.channels.followPermission')}
                        </span>
                      </div>
                      <div className="system-xs-regular text-text-tertiary">
                        {t('access.runAccess.webappDesc')}
                      </div>
                      {webappRows.length > 0
                        ? (
                            <div className="flex flex-col gap-1.5">
                              {webappRows.map((row) => {
                                const endpointUrl = webappUrl(row.url)

                                return (
                                  <EndpointRow
                                    key={`webapp-${row.environment?.id ?? row.url}`}
                                    envName={environmentName(row.environment)}
                                    label={t('access.runAccess.urlLabel')}
                                    value={endpointUrl}
                                    openLabel={t('access.runAccess.openWebapp')}
                                  />
                                )
                              })}
                            </div>
                          )
                        : (
                            <SectionState>
                              {t('access.runAccess.webappEmpty')}
                            </SectionState>
                          )}
                    </div>
                    <div className="flex flex-col gap-2 border-t border-divider-subtle pt-3.5">
                      <div className="flex items-center gap-2">
                        <div className="system-sm-medium text-text-primary">
                          {t('access.cli.title')}
                        </div>
                        <span className="inline-flex h-5 items-center rounded-full bg-state-success-hover px-1.5 system-2xs-medium text-state-success-solid">
                          {t('access.channels.followPermission')}
                        </span>
                      </div>
                      <div className="system-xs-regular text-text-tertiary">
                        {t('access.cli.description')}
                      </div>
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
                            <div className="system-xs-regular text-text-tertiary">
                              {t('access.cli.empty')}
                            </div>
                          )}
                    </div>
                  </div>
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
