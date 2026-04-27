'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeploymentsStore } from '../store'

const GRID_TEMPLATE = 'grid-cols-[0.9fr_1fr_0.8fr_1.5fr_auto]'

type ReleaseDeploymentState = 'active' | 'deploying' | 'failed'

type ReleaseDeployment = {
  environmentId: string
  environmentName: string
  state: ReleaseDeploymentState
}

const RELEASE_DEPLOYMENT_STYLES: Record<ReleaseDeploymentState, string> = {
  active: 'border-util-colors-green-green-200 bg-util-colors-green-green-50 text-util-colors-green-green-700',
  deploying: 'border-util-colors-blue-blue-200 bg-util-colors-blue-blue-50 text-util-colors-blue-blue-700',
  failed: 'border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 text-util-colors-warning-warning-700',
}

type DeployReleaseMenuProps = {
  releaseId: string
  instanceId: string
}

const DeployReleaseMenu: FC<DeployReleaseMenuProps> = ({ releaseId, instanceId }) => {
  const { t } = useTranslation('deployments')
  const environments = useDeploymentsStore(state => state.environments)
  const deployments = useDeploymentsStore(state => state.deployments)
  const openDeployDrawer = useDeploymentsStore(state => state.openDeployDrawer)
  const openRollbackModal = useDeploymentsStore(state => state.openRollbackModal)
  const [open, setOpen] = useState(false)

  const instanceDeployments = deployments.filter(d => d.instanceId === instanceId)

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-md px-2 system-xs-medium',
          'border border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-accent-text',
          'hover:bg-components-button-secondary-bg-hover',
        )}
      >
        {t('versions.deploy')}
        <span className="i-ri-arrow-down-s-line h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      {open && (
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-[220px]">
          {environments.map((env) => {
            const deployment = instanceDeployments.find(d => d.environmentId === env.id)
            const isCurrent = deployment?.activeReleaseId === releaseId
            const isEnvironmentDeploying = deployment?.status === 'deploying'
            return (
              <DropdownMenuItem
                key={env.id}
                className="gap-2 px-3"
                disabled={isCurrent || isEnvironmentDeploying}
                onClick={() => {
                  setOpen(false)
                  if (isCurrent || isEnvironmentDeploying)
                    return
                  if (deployment) {
                    openRollbackModal({
                      deploymentId: deployment.id,
                      targetReleaseId: releaseId,
                    })
                    return
                  }
                  openDeployDrawer({ instanceId, environmentId: env.id, releaseId })
                }}
              >
                <span className="system-sm-regular text-text-secondary">
                  {isEnvironmentDeploying
                    ? t('versions.deployingTo', { name: env.name })
                    : isCurrent
                      ? t('versions.currentOn', { name: env.name })
                      : deployment
                        ? t('versions.promoteTo', { name: env.name })
                        : t('versions.deployTo', { name: env.name })}
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}

type ReleaseMoreMenuProps = {
  previewVisible: boolean
  onTogglePreview: () => void
}

const ReleaseMoreMenu: FC<ReleaseMoreMenuProps> = ({ previewVisible, onTogglePreview }) => {
  const { t } = useTranslation('deployments')
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={t('versions.moreActions')}
        className={cn(
          open ? 'bg-state-base-hover text-text-secondary' : 'text-text-tertiary',
          'flex h-7 w-7 items-center justify-center rounded-md hover:bg-state-base-hover hover:text-text-secondary',
        )}
      >
        <span className="i-ri-more-line h-4 w-4" />
      </DropdownMenuTrigger>
      {open && (
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-[180px]">
          <DropdownMenuItem
            className="gap-2 px-3"
            onClick={() => {
              setOpen(false)
              onTogglePreview()
            }}
          >
            <span className="i-ri-file-code-line h-4 w-4 text-text-tertiary" />
            <span className="system-sm-regular text-text-secondary">
              {previewVisible ? t('versions.hideYaml') : t('versions.viewYaml')}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}

const DeployedToBadge: FC<{ item: ReleaseDeployment }> = ({ item }) => {
  const { t } = useTranslation('deployments')
  const statusLabel = t(`versions.deployedStatus.${item.state}`)

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 system-xs-medium',
              RELEASE_DEPLOYMENT_STYLES[item.state],
            )}
          >
            {item.state === 'deploying'
              ? <span className="i-ri-loader-4-line h-3.5 w-3.5 animate-spin" />
              : item.state === 'failed'
                ? <span className="i-ri-alert-line h-3.5 w-3.5" />
                : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            {item.environmentName}
          </span>
        )}
      />
      <TooltipContent>
        {statusLabel}
        {' · '}
        {item.environmentName}
      </TooltipContent>
    </Tooltip>
  )
}

type VersionsTabProps = {
  instanceId: string
}

const VersionsTab: FC<VersionsTabProps> = ({ instanceId }) => {
  const { t } = useTranslation('deployments')
  const instances = useDeploymentsStore(state => state.instances)
  const releases = useDeploymentsStore(state => state.releases)
  const deployments = useDeploymentsStore(state => state.deployments)
  const environments = useDeploymentsStore(state => state.environments)

  const instance = instances.find(i => i.id === instanceId)

  const instanceDeployments = useMemo(
    () => deployments.filter(d => d.instanceId === instanceId),
    [deployments, instanceId],
  )

  const appReleases = useMemo(() => {
    if (!instance)
      return []
    const deployedReleaseIds = new Set<string>()
    instanceDeployments.forEach((deployment) => {
      deployedReleaseIds.add(deployment.activeReleaseId)
      if (deployment.targetReleaseId)
        deployedReleaseIds.add(deployment.targetReleaseId)
      if (deployment.failedReleaseId)
        deployedReleaseIds.add(deployment.failedReleaseId)
    })
    return releases.filter(r => r.appId === instance.appId || deployedReleaseIds.has(r.id))
  }, [releases, instance, instanceDeployments])

  const [previewId, setPreviewId] = useState<string | null>(null)

  if (!instance)
    return null

  const envMap = new Map(environments.map(env => [env.id, env]))

  const getReleaseDeployments = (releaseId: string) => {
    return instanceDeployments.flatMap((deployment) => {
      const env = envMap.get(deployment.environmentId)
      if (!env)
        return []

      const items: ReleaseDeployment[] = []
      if (deployment.activeReleaseId === releaseId) {
        items.push({
          environmentId: deployment.environmentId,
          environmentName: env.name,
          state: 'active',
        })
      }
      if (deployment.status === 'deploying' && deployment.targetReleaseId === releaseId) {
        items.push({
          environmentId: deployment.environmentId,
          environmentName: env.name,
          state: 'deploying',
        })
      }
      if (deployment.status === 'deploy_failed' && deployment.failedReleaseId === releaseId) {
        items.push({
          environmentId: deployment.environmentId,
          environmentName: env.name,
          state: 'failed',
        })
      }
      return items
    })
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="system-sm-semibold text-text-primary">
          {t('versions.releaseHistory')}
          {' '}
          <span className="system-sm-regular text-text-tertiary">
            (
            {appReleases.length}
            )
          </span>
        </div>
      </div>

      {appReleases.length === 0
        ? (
            <div className="rounded-xl border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-12 text-center system-sm-regular text-text-tertiary">
              {t('versions.empty')}
            </div>
          )
        : (
            <div className="overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg">
              <div className={cn(
                'hidden items-center gap-4 border-b border-divider-subtle px-4 py-3 system-xs-medium-uppercase text-text-tertiary lg:grid',
                GRID_TEMPLATE,
              )}
              >
                <div>{t('versions.col.release')}</div>
                <div>{t('versions.col.createdAt')}</div>
                <div>{t('versions.col.author')}</div>
                <div>{t('versions.col.deployedTo')}</div>
                <div className="text-right">{t('versions.col.action')}</div>
              </div>

              {appReleases.map((release) => {
                const releaseDeployments = getReleaseDeployments(release.id)
                const isPreview = previewId === release.id
                return (
                  <div key={release.id} className="border-b border-divider-subtle last:border-b-0">
                    <div className="flex flex-col gap-3 px-4 py-3 lg:hidden">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="system-xs-medium-uppercase text-text-tertiary">
                            {t('versions.col.release')}
                          </div>
                          <Tooltip>
                            <TooltipTrigger
                              render={(
                                <span className="mt-1 inline-flex max-w-full cursor-default truncate font-mono system-sm-medium text-text-primary">
                                  {release.id}
                                </span>
                              )}
                            />
                            <TooltipContent>
                              {t('versions.commitTooltip', { commit: release.gateCommitId })}
                            </TooltipContent>
                          </Tooltip>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 system-xs-regular text-text-tertiary">
                            <span>{release.createdAt}</span>
                            <span aria-hidden>·</span>
                            <span>{release.operator}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 justify-end gap-1">
                          <DeployReleaseMenu releaseId={release.id} instanceId={instanceId} />
                          <ReleaseMoreMenu
                            previewVisible={isPreview}
                            onTogglePreview={() => setPreviewId(prev => (prev === release.id ? null : release.id))}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="system-xs-medium-uppercase text-text-tertiary">
                          {t('versions.col.deployedTo')}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {releaseDeployments.length === 0
                            ? <span className="system-sm-regular text-text-quaternary">—</span>
                            : releaseDeployments.map(item => (
                                <DeployedToBadge
                                  key={`${item.environmentId}-${item.state}`}
                                  item={item}
                                />
                              ))}
                        </div>
                      </div>
                    </div>
                    <div className={cn(
                      'hidden items-center gap-4 px-4 py-3 lg:grid',
                      GRID_TEMPLATE,
                    )}
                    >
                      <div>
                        <Tooltip>
                          <TooltipTrigger
                            render={(
                              <span className="inline-flex cursor-default font-mono system-sm-medium text-text-primary">
                                {release.id}
                              </span>
                            )}
                          />
                          <TooltipContent>
                            {t('versions.commitTooltip', { commit: release.gateCommitId })}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="system-sm-regular text-text-secondary">{release.createdAt}</div>
                      <div className="system-sm-regular text-text-secondary">{release.operator}</div>
                      <div className="flex flex-wrap gap-1">
                        {releaseDeployments.length === 0
                          ? <span className="system-sm-regular text-text-quaternary">—</span>
                          : releaseDeployments.map(item => (
                              <DeployedToBadge
                                key={`${item.environmentId}-${item.state}`}
                                item={item}
                              />
                            ))}
                      </div>
                      <div className="flex justify-end gap-1">
                        <DeployReleaseMenu releaseId={release.id} instanceId={instanceId} />
                        <ReleaseMoreMenu
                          previewVisible={isPreview}
                          onTogglePreview={() => setPreviewId(prev => (prev === release.id ? null : release.id))}
                        />
                      </div>
                    </div>
                    {isPreview && (
                      <div className="border-t border-divider-subtle bg-background-default-subtle">
                        <pre className="overflow-auto px-4 py-3 font-mono text-[12.5px] leading-5 text-text-secondary">
                          {release.yaml}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}

export default VersionsTab
