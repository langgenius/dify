'use client'

import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { FC, ReactNode } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { Badge as Badge2 } from '@/app/components/base/badge/index'
import Card from '@/app/components/plugins/card'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import useWorkspacePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import { pluginManifestToCardPluginProps } from '@/app/components/plugins/install-plugin/utils'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { marketplaceQuery } from '@/service/marketplace'
import {
  normalizeInstalledPluginDetail,
  useUpdatePackageFromMarketPlace,
} from '@/service/use-plugins'
import { getMarketplaceUrl } from '@/utils/var'

type PluginVersionSelection = {
  plugin: PluginDetail
  target: Pick<PluginVersionsResponse['data']['versions'][number], 'version' | 'unique_identifier'>
}

type SwitchPluginVersionProps = {
  uniqueIdentifier: string
  tooltip?: ReactNode
  onChange?: (version: string) => void
  className?: string
}

export const SwitchPluginVersion: FC<SwitchPluginVersionProps> = (props) => {
  const { uniqueIdentifier, tooltip, onChange, className } = props

  const [pluginId] = uniqueIdentifier.split(':')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [requestedOpen, setRequestedOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const [selection, setSelection] = useState<PluginVersionSelection>()
  const { canUpdatePlugin } = useWorkspacePluginInstallPermission()
  const pluginDetails = useQuery(
    consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryOptions({
      input: pluginId ? { body: { plugin_ids: [pluginId] } } : skipToken,
      enabled: canUpdatePlugin,
      staleTime: 0,
      select: (response) =>
        response.plugins[0] ? normalizeInstalledPluginDetail(response.plugins[0]) : undefined,
    }),
  )
  const pluginDetail = pluginDetails.data

  const { t } = useTranslation(['workflowAgent', 'plugin', 'common', 'appLog'])
  const versionMenuLabelId = useId()
  const { formatDate } = useTimestamp()
  const dateFormat = t(($) => $.dateTimeFormat, { ns: 'appLog' }).split(' ')[0]!

  const [organization, pluginName] = pluginId?.split('/') ?? []
  const versionsQuery = useQuery(
    marketplaceQuery.pluginVersions.queryOptions({
      input:
        organization && pluginName
          ? { params: { organization, pluginName }, query: { page: 1, page_size: 100 } }
          : skipToken,
      enabled: requestedOpen && canUpdatePlugin,
      retry: false,
    }),
  )
  const loadingVersions = requestedOpen && versionsQuery.isPending

  return (
    <div
      className={cn('flex w-fit items-center justify-center', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent className="w-140" finalFocus={triggerRef}>
          {selection && (
            <PluginVersionInstallConfirmation
              selection={selection}
              onInstalled={(version) => {
                void pluginDetails.refetch()
                onChange?.(version)
                setInstallOpen(false)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <DropdownMenu
        open={requestedOpen && !!pluginDetail && canUpdatePlugin && !loadingVersions}
        onOpenChange={setRequestedOpen}
      >
        {pluginDetail && canUpdatePlugin && (
          <Tooltip disabled={!tooltip || requestedOpen}>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  ref={triggerRef}
                  render={
                    <Button
                      variant="ghost"
                      size="small"
                      loading={loadingVersions}
                      className="relative mx-1 h-5 overflow-visible rounded-[5px] border border-divider-deep px-1.25 system-2xs-medium-uppercase text-text-tertiary"
                    >
                      <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-xs border border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg shadow-sm" />
                      <span className="sr-only">
                        {t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })}{' '}
                      </span>
                      <span>{pluginDetail.version}</span>
                      {!loadingVersions && (
                        <span aria-hidden className="i-ri-arrow-left-right-line size-3" />
                      )}
                    </Button>
                  }
                />
              }
            />
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenuContent
          className="max-h-[min(16rem,var(--available-height))]"
          align="start"
          aria-labelledby={versionMenuLabelId}
        >
          <DropdownMenuGroup>
            <DropdownMenuGroupLabel id={versionMenuLabelId}>
              {t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })}
            </DropdownMenuGroupLabel>
            {versionsQuery.data && pluginDetail ? (
              versionsQuery.data.data.versions.map((item) => (
                <DropdownMenuItem
                  key={item.unique_identifier}
                  disabled={pluginDetail.version === item.version}
                  onClick={() => {
                    setSelection({ plugin: pluginDetail, target: item })
                    setInstallOpen(true)
                  }}
                >
                  <span>{item.version}</span>
                  {pluginDetail.version === item.version && (
                    <Badge className="shrink-0" variant="dimm" text="CURRENT" />
                  )}
                  <span className="ms-auto text-text-tertiary">
                    {formatDate(item.created_at, dateFormat)}
                  </span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem closeOnClick={false} onClick={() => void versionsQuery.refetch()}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function PluginVersionInstallConfirmation({
  selection,
  onInstalled,
}: {
  selection: PluginVersionSelection
  onInstalled: (version: PluginVersionSelection['target']['version']) => void
}) {
  const { t } = useTranslation(['workflowAgent', 'common'])
  const { canUpdatePlugin } = useWorkspacePluginInstallPermission()
  const { getIconUrl } = useGetIcon()
  const mutation = useUpdatePackageFromMarketPlace()
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['nodes.agent.installPlugin.title'], { ns: 'workflowAgent' })}
        </DialogTitle>
        <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>
      <DialogBody>
        <div className="mb-2 system-md-regular text-text-secondary">
          {t(($) => $['nodes.agent.installPlugin.desc'], { ns: 'workflowAgent' })}
        </div>
        <div className="flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2">
          <Card
            installed={mutation.isSuccess}
            payload={pluginManifestToCardPluginProps({
              ...selection.plugin.declaration,
              icon: getIconUrl(selection.plugin.declaration.icon),
            })}
            className="w-full"
            titleLeft={
              <Badge2 className="mx-1" size="s" variant="warning">
                {`${selection.plugin.version} -> ${selection.target.version}`}
              </Badge2>
            }
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Link
          className="me-auto flex items-center justify-center gap-1"
          href={getMarketplaceUrl(
            `/plugins/${selection.plugin.declaration.author}/${selection.plugin.declaration.name}`,
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="system-xs-regular text-xs text-text-accent">
            {t(($) => $['nodes.agent.installPlugin.changelog'], { ns: 'workflowAgent' })}
          </span>
          <span className="i-ri-external-link-line size-3 text-text-accent" />
        </Link>
        {!mutation.isPending && (
          <DialogClose render={<Button />}>
            {t(($) => $['nodes.agent.installPlugin.cancel'], { ns: 'workflowAgent' })}
          </DialogClose>
        )}
        <Button
          variant="primary"
          loading={mutation.isPending}
          disabled={!canUpdatePlugin}
          onClick={() => {
            if (!canUpdatePlugin) return
            mutation.mutate(
              {
                new_plugin_unique_identifier: selection.target.unique_identifier,
                original_plugin_unique_identifier: selection.plugin.plugin_unique_identifier,
              },
              {
                onSuccess: () => {
                  onInstalled(selection.target.version)
                },
              },
            )
          }}
        >
          {t(($) => $['nodes.agent.installPlugin.install'], { ns: 'workflowAgent' })}
        </Button>
      </DialogFooter>
    </>
  )
}
