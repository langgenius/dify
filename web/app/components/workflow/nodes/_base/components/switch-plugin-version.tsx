'use client'

import type { PluginVersionsResponse } from '@dify/contracts/marketplace'
import type { FC, ReactNode } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  createDialogHandle,
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
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { Badge as VersionBadge } from '@/app/components/base/badge/index'
import Card from '@/app/components/plugins/card'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import useWorkspacePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import { pluginManifestToCardPluginProps } from '@/app/components/plugins/install-plugin/utils'
import { PluginCategoryEnum, TaskStatus } from '@/app/components/plugins/types'
import { useMarketplace, useMarketplacePluginVersions } from '@/features/marketplace/client'
import useTimestamp from '@/hooks/use-timestamp'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import {
  normalizeInstalledPluginDetail,
  useInvalidateInstalledPluginList,
} from '@/service/use-plugins'

type PluginVersionSelection = {
  plugin: PluginDetail
  target: Pick<PluginVersionsResponse['data']['versions'][number], 'version' | 'unique_identifier'>
}

type SwitchPluginVersionProps = {
  uniqueIdentifier: string
  tooltip?: ReactNode
  className?: string
}

export const SwitchPluginVersion: FC<SwitchPluginVersionProps> = (props) => {
  const { uniqueIdentifier, tooltip, className } = props

  const [pluginId] = uniqueIdentifier.split(':')
  const [requestedOpen, setRequestedOpen] = useState(false)
  const [acceptedTaskId, setAcceptedTaskId] = useState<string | null>(null)
  const [installDialog] = useState(() => createDialogHandle<PluginVersionSelection>())
  const { getIconUrl } = useGetIcon()
  const queryClient = useQueryClient()
  const invalidatePluginList = useInvalidateInstalledPluginList()
  const { canUpdatePlugin } = useWorkspacePluginInstallPermission()
  const marketplace = useMarketplace()
  const pluginDetails = useQuery(
    consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryOptions({
      input: canUpdatePlugin && pluginId ? { body: { plugin_ids: [pluginId] } } : skipToken,
      staleTime: 0,
      select: (response) =>
        response.plugins[0] ? normalizeInstalledPluginDetail(response.plugins[0]) : undefined,
    }),
  )
  const pluginDetail = pluginDetails.data

  const { t } = useTranslation(['workflowAgent', 'plugin', 'common', 'appLog'])
  // The dialog shows the upgrade failure inline, so neither request toasts it.
  const { mutateAsync: startMarketplacePluginUpgrade } = useMutation(
    consoleQuery.workspaces.current.plugin.upgrade.marketplace.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const upgrade = useMutation({
    meta: { errorToast: false },
    mutationFn: async ({ plugin, target }: PluginVersionSelection) => {
      let taskId = acceptedTaskId
      if (!taskId) {
        const response = await startMarketplacePluginUpgrade({
          body: {
            new_plugin_unique_identifier: target.unique_identifier,
            original_plugin_unique_identifier: plugin.plugin_unique_identifier,
          },
        })
        if (response.all_installed || response.task?.status === TaskStatus.success) return
        if (response.task?.status === TaskStatus.failed) {
          const failed = response.task.plugins.find(
            (item) => item.plugin_unique_identifier === target.unique_identifier,
          )
          throw new Error(failed?.message || t(($) => $.error, { ns: 'common' }))
        }
        if (!response.task_id) throw new Error(t(($) => $.error, { ns: 'common' }))
        taskId = response.task_id
        setAcceptedTaskId(taskId)
      }
      const result = await checkTaskStatus().check({
        taskId,
        pluginUniqueIdentifier: target.unique_identifier,
      })
      setAcceptedTaskId(null)
      if (result.status === TaskStatus.failed)
        throw new Error(result.error || t(($) => $.error, { ns: 'common' }))
    },
    onSuccess: (_data, { plugin }) => {
      const category = plugin.declaration.category
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.plugin.list.installations.ids.post.key(),
      })
      void invalidatePluginList(category)
      if (category === PluginCategoryEnum.agent) {
        const workspace = consoleQuery.workspaces.current
        void queryClient.invalidateQueries({ queryKey: workspace.agentProviders.get.key() })
        void queryClient.invalidateQueries({
          queryKey: workspace.agentProvider.byProviderName.get.key(),
        })
      }
    },
  })
  const versionMenuLabelId = useId()
  const { formatDate } = useTimestamp()
  const dateFormat = t(($) => $.dateTimeFormat, { ns: 'appLog' }).split(' ')[0]!

  const canSwitchVersion = canUpdatePlugin && marketplace !== null
  const versionsQuery = useMarketplacePluginVersions(pluginId, requestedOpen && canSwitchVersion)
  const loadingVersions = requestedOpen && versionsQuery.isPending

  return (
    <div
      className={cn('flex w-fit items-center justify-center', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <Dialog
        handle={installDialog}
        onOpenChange={(open, details) => {
          if (open) {
            setAcceptedTaskId(null)
            upgrade.reset()
          } else if (upgrade.isPending && details.reason !== 'imperative-action') details.cancel()
        }}
      >
        {({ payload: selection }) =>
          selection && (
            <DialogContent className="w-140">
              <DialogHeader>
                <DialogTitle>
                  {t(($) => $['nodes.agent.installPlugin.title'], { ns: 'workflowAgent' })}
                </DialogTitle>
                <DialogHeaderCloseButton
                  disabled={upgrade.isPending}
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                />
              </DialogHeader>
              <DialogBody>
                <div className="mb-2 system-md-regular text-text-secondary">
                  {t(($) => $['nodes.agent.installPlugin.desc'], { ns: 'workflowAgent' })}
                </div>
                <div className="flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2">
                  <Card
                    installed={upgrade.isSuccess}
                    payload={pluginManifestToCardPluginProps({
                      ...selection.plugin.declaration,
                      icon: getIconUrl(selection.plugin.declaration.icon),
                    })}
                    className="w-full"
                    titleLeft={
                      <VersionBadge className="mx-1" size="s" variant="warning">
                        {`${selection.plugin.version} -> ${selection.target.version}`}
                      </VersionBadge>
                    }
                  />
                </div>
                {upgrade.isError && (
                  <p role="alert" className="mt-2 text-text-destructive">
                    {upgrade.error.message}
                  </p>
                )}
              </DialogBody>
              <DialogFooter>
                {marketplace && (
                  <Link
                    className="me-auto flex items-center justify-center gap-1"
                    href={marketplace.plugin({
                      org: selection.plugin.declaration.author,
                      name: selection.plugin.declaration.name,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="system-xs-regular text-xs text-text-accent">
                      {t(($) => $['nodes.agent.installPlugin.changelog'], { ns: 'workflowAgent' })}
                    </span>
                    <span className="i-ri-external-link-line size-3 text-text-accent" />
                  </Link>
                )}
                <DialogClose render={<Button disabled={upgrade.isPending} />}>
                  {t(($) => $['nodes.agent.installPlugin.cancel'], { ns: 'workflowAgent' })}
                </DialogClose>
                <Button
                  variant="primary"
                  loading={upgrade.isPending}
                  disabled={!canUpdatePlugin}
                  onClick={() => {
                    if (!canUpdatePlugin || upgrade.isPending) return
                    upgrade.mutate(selection, {
                      onSuccess: () => installDialog.close(),
                    })
                  }}
                >
                  {acceptedTaskId && upgrade.isError
                    ? t(($) => $['operation.retry'], { ns: 'common' })
                    : t(($) => $['nodes.agent.installPlugin.install'], { ns: 'workflowAgent' })}
                </Button>
              </DialogFooter>
            </DialogContent>
          )
        }
      </Dialog>
      <Menu
        open={requestedOpen && !!pluginDetail && canSwitchVersion && !loadingVersions}
        onOpenChange={setRequestedOpen}
      >
        {pluginDetail && canUpdatePlugin && (
          <Tooltip disabled={!tooltip || requestedOpen}>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={!canSwitchVersion}
                      focusableWhenDisabled
                      loading={loadingVersions}
                      className="relative mx-1 h-5 overflow-visible rounded-[5px] border border-divider-deep px-1.25 system-2xs-medium-uppercase text-text-tertiary"
                    >
                      <span className="absolute -inset-e-0.5 -top-0.5 size-1.5 rounded-xs border border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg shadow-sm" />
                      <span className="sr-only">
                        {t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })}{' '}
                      </span>
                      <span>{pluginDetail.version}</span>
                      {canSwitchVersion && !loadingVersions && (
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
        <MenuContent
          className="max-h-[min(16rem,var(--available-height))]"
          align="start"
          aria-labelledby={versionMenuLabelId}
        >
          <MenuGroup>
            <MenuGroupLabel id={versionMenuLabelId}>
              {t(($) => $['detailPanel.switchVersion'], { ns: 'plugin' })}
            </MenuGroupLabel>
            {versionsQuery.data && pluginDetail ? (
              versionsQuery.data.data.versions.map((item) => (
                <MenuItem
                  key={item.unique_identifier}
                  disabled={pluginDetail.version === item.version}
                  onClick={() =>
                    installDialog.openWithPayload({ plugin: pluginDetail, target: item })
                  }
                >
                  <span>{item.version}</span>
                  {pluginDetail.version === item.version && (
                    <Badge className="shrink-0" variant="dimm" text="CURRENT" />
                  )}
                  <span className="ms-auto text-text-tertiary">
                    {formatDate(item.created_at, dateFormat)}
                  </span>
                </MenuItem>
              ))
            ) : (
              <MenuItem closeOnClick={false} onClick={() => void versionsQuery.refetch()}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </MenuItem>
            )}
          </MenuGroup>
        </MenuContent>
      </Menu>
    </div>
  )
}
