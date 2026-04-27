'use client'
import type { FC } from 'react'
import type { Deployment, Environment, Release } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mockCredentials } from '../mock-data'
import { HealthBadge, ModeBadge } from '../status-badge'
import { useDeploymentsStore } from '../store'

const GRID_TEMPLATE = 'lg:grid-cols-[1.2fr_0.8fr_1fr_auto]'

type InfoBlockProps = {
  title: string
  children: React.ReactNode
}

const InfoBlock: FC<InfoBlockProps> = ({ title, children }) => (
  <div className="flex flex-col gap-1.5">
    <div className="system-xs-medium-uppercase text-text-tertiary">{title}</div>
    <div className="flex flex-col gap-1">{children}</div>
  </div>
)

type InfoRowProps = {
  label: string
  value: React.ReactNode
  mono?: boolean
  suffix?: string
}

const InfoRow: FC<InfoRowProps> = ({ label, value, mono, suffix }) => (
  <div className="flex items-start gap-2 py-0.5">
    <span className="w-24 shrink-0 system-xs-regular text-text-tertiary">{label}</span>
    <span className={cn('min-w-0 flex-1 system-sm-regular break-words text-text-primary', mono && 'font-mono')}>
      {value}
      {suffix && <span className="system-xs-regular text-text-tertiary">{suffix}</span>}
    </span>
  </div>
)

type DeploymentPanelProps = {
  deployment: Deployment
  env: Environment
  release?: Release
  targetRelease?: Release
  failedRelease?: Release
}

const DeploymentPanel: FC<DeploymentPanelProps> = ({ deployment, env, release, targetRelease, failedRelease }) => {
  const { t } = useTranslation('deployments')
  const credentialMap = useMemo(
    () => new Map(mockCredentials.map(c => [c.id, c])),
    [],
  )

  const modelCreds = deployment.credentials.filter(c => c.kind === 'model')
  const pluginCreds = deployment.credentials.filter(c => c.kind === 'plugin')

  return (
    <div className="border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="system-sm-semibold text-text-primary">
          {env.name}
          {' · '}
          {deployment.activeReleaseId}
        </span>
        <ModeBadge mode={env.mode} />
        <HealthBadge health={env.health} />
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
        <InfoBlock title={t('deployTab.panel.instanceInfo')}>
          <InfoRow label={t('deployTab.panel.deploymentId')} value={deployment.id} mono />
          <InfoRow label={t('deployTab.panel.replicas')} value={deployment.replicas != null ? String(deployment.replicas) : '—'} />
          <InfoRow label={t('deployTab.panel.runtimeMode')} value={t(env.mode === 'isolated' ? 'mode.isolated' : 'mode.shared')} suffix={` / ${env.backend.toUpperCase()}`} />
          <InfoRow label={t('deployTab.panel.runtimeNote')} value={deployment.runtimeNote ?? '—'} />
        </InfoBlock>

        <InfoBlock title={t('deployTab.panel.releaseInfo')}>
          <InfoRow label={t('deployTab.panel.release')} value={release?.id ?? deployment.activeReleaseId} mono />
          <InfoRow label={t('deployTab.panel.commit')} value={release?.gateCommitId ?? '—'} mono />
          <InfoRow label={t('deployTab.panel.createdAt')} value={release?.createdAt ?? '—'} />
          {targetRelease && (
            <InfoRow label={t('deployTab.panel.targetRelease')} value={`${targetRelease.id} / ${targetRelease.gateCommitId}`} mono />
          )}
          {failedRelease && (
            <InfoRow label={t('deployTab.panel.failedRelease')} value={`${failedRelease.id} / ${failedRelease.gateCommitId}`} mono />
          )}
        </InfoBlock>

        <InfoBlock title={t('deployTab.panel.endpoints')}>
          <InfoRow label={t('deployTab.panel.run')} value={`/${env.namespace}/run`} mono />
          <InfoRow label={t('deployTab.panel.health')} value={`/${env.namespace}/readyz`} mono />
        </InfoBlock>

        {modelCreds.length > 0 && (
          <InfoBlock title={t('deployTab.panel.modelCreds')}>
            {modelCreds.map(c => (
              <InfoRow
                key={`model-${c.provider}`}
                label={c.provider}
                value={credentialMap.get(c.credentialId ?? '')?.name ?? '—'}
                mono
              />
            ))}
          </InfoBlock>
        )}

        {pluginCreds.length > 0 && (
          <InfoBlock title={t('deployTab.panel.pluginCreds')}>
            {pluginCreds.map(c => (
              <InfoRow
                key={`plugin-${c.provider}`}
                label={c.provider}
                value={credentialMap.get(c.credentialId ?? '')?.name ?? '—'}
                mono
              />
            ))}
          </InfoBlock>
        )}

        {deployment.envVariables.length > 0 && (
          <InfoBlock title={t('deployTab.panel.envVars')}>
            {deployment.envVariables.map(v => (
              <InfoRow
                key={v.key}
                label={v.key}
                value={v.type === 'secret' ? '••••••' : v.value}
                mono
                suffix={` (${v.type})`}
              />
            ))}
          </InfoBlock>
        )}
      </div>

      {deployment.status === 'deploy_failed' && deployment.errorMessage && (
        <div className="mt-4 rounded-lg border border-util-colors-red-red-200 bg-util-colors-red-red-50 px-3 py-2 system-xs-regular text-util-colors-red-red-700">
          {deployment.errorMessage}
        </div>
      )}
    </div>
  )
}

type DeploymentStatusSummaryProps = {
  deployment: Deployment
}

const DeploymentStatusSummary: FC<DeploymentStatusSummaryProps> = ({ deployment }) => {
  const { t } = useTranslation('deployments')

  if (deployment.status === 'deploying') {
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-util-colors-blue-blue-700">
        <span className="i-ri-loader-4-line h-3.5 w-3.5 animate-spin" />
        {t('deployTab.status.deployingRelease', { release: deployment.targetReleaseId ?? deployment.activeReleaseId })}
      </span>
    )
  }

  if (deployment.status === 'deploy_failed') {
    return (
      <span className="inline-flex items-center gap-1.5 system-sm-medium text-util-colors-warning-warning-700">
        <span className="i-ri-alert-line h-3.5 w-3.5" />
        {t('deployTab.status.runningWithFailed')}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 system-sm-medium text-util-colors-green-green-700">
      <span className="h-1.5 w-1.5 rounded-full bg-util-colors-green-green-500" />
      {t('status.ready')}
    </span>
  )
}

type RowPrimaryActionProps = {
  deployment: Deployment
  onPromote: () => void
  onViewProgress: () => void
  onViewLogs: () => void
}

const RowPrimaryAction: FC<RowPrimaryActionProps> = ({ deployment, onPromote, onViewProgress, onViewLogs }) => {
  const { t } = useTranslation('deployments')

  if (deployment.status === 'deploying') {
    return (
      <Button size="small" variant="secondary" onClick={onViewProgress}>
        {t('deployTab.viewProgress')}
      </Button>
    )
  }

  if (deployment.status === 'deploy_failed') {
    return (
      <Button size="small" variant="secondary" onClick={onViewLogs}>
        {t('deployTab.viewLogs')}
      </Button>
    )
  }

  return (
    <Button size="small" variant="secondary" onClick={onPromote}>
      {t('deployTab.deployOtherVersion')}
    </Button>
  )
}

type DeploymentMenuProps = {
  deployment: Deployment
  onUndeploy: () => void
}

const DeploymentMenu: FC<DeploymentMenuProps> = ({ deployment, onUndeploy }) => {
  const { t } = useTranslation('deployments')
  const [menuOpen, setMenuOpen] = useState(false)
  const itemLabel = deployment.status === 'deploying'
    ? t('deployTab.cancelDeployment')
    : t('deployTab.undeploy')

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        aria-label={t('deployTab.moreActions')}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
      >
        <span className="i-ri-more-line h-4 w-4" />
      </DropdownMenuTrigger>
      {menuOpen && (
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-[200px]">
          <DropdownMenuItem
            className="gap-2 px-3"
            onClick={() => {
              setMenuOpen(false)
              onUndeploy()
            }}
          >
            <span className="system-sm-regular text-text-destructive">
              {itemLabel}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}

type DeployTabProps = {
  instanceId: string
}

const DeployTab: FC<DeployTabProps> = ({ instanceId }) => {
  const { t } = useTranslation('deployments')
  const environments = useDeploymentsStore(state => state.environments)
  const deployments = useDeploymentsStore(state => state.deployments)
  const openDeployDrawer = useDeploymentsStore(state => state.openDeployDrawer)
  const undeployDeployment = useDeploymentsStore(state => state.undeployDeployment)
  const releases = useDeploymentsStore(state => state.releases)

  const instanceDeployments = useMemo(
    () => deployments.filter(d => d.instanceId === instanceId),
    [deployments, instanceId],
  )

  const envMap = useMemo(
    () => new Map(environments.map(env => [env.id, env])),
    [environments],
  )

  const [expanded, setExpanded] = useState<string | null>(() => instanceDeployments[0]?.id ?? null)

  const toggle = (id: string) => setExpanded(prev => (prev === id ? null : id))

  const [deployMenuOpen, setDeployMenuOpen] = useState(false)
  const availableEnvs = environments.filter(env => !instanceDeployments.some(d => d.environmentId === env.id))

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="system-sm-semibold text-text-primary">
          {t('deployTab.envCount')}
          {' '}
          <span className="system-sm-regular text-text-tertiary">
            (
            {instanceDeployments.length}
            )
          </span>
        </div>
        <DropdownMenu modal={false} open={deployMenuOpen} onOpenChange={setDeployMenuOpen}>
          <DropdownMenuTrigger
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-3 system-sm-medium',
              'border border-components-button-primary-border bg-components-button-primary-bg text-components-button-primary-text',
              'hover:bg-components-button-primary-bg-hover',
            )}
          >
            <span className="i-ri-rocket-line h-3.5 w-3.5" />
            {t('deployTab.newDeployment')}
            <span className="i-ri-arrow-down-s-line h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          {deployMenuOpen && (
            <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-[220px]">
              <DropdownMenuItem
                className="gap-2 px-3"
                onClick={() => {
                  setDeployMenuOpen(false)
                  openDeployDrawer({ instanceId })
                }}
              >
                <span className="system-sm-regular text-text-secondary">{t('deployTab.deployToNewEnv')}</span>
              </DropdownMenuItem>
              {availableEnvs.length > 0 && (
                <>
                  <div className="px-3 py-1 system-xs-medium-uppercase text-text-quaternary">{t('deployTab.shortcut')}</div>
                  {availableEnvs.map(env => (
                    <DropdownMenuItem
                      key={env.id}
                      className="gap-2 px-3"
                      onClick={() => {
                        setDeployMenuOpen(false)
                        openDeployDrawer({ instanceId, environmentId: env.id })
                      }}
                    >
                      <span className="system-sm-regular text-text-secondary">
                        {t('deployTab.deployToEnv', { name: env.name })}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </div>

      {instanceDeployments.length === 0
        ? (
            <div className="rounded-xl border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-12 text-center system-sm-regular text-text-tertiary">
              {t('deployTab.empty')}
            </div>
          )
        : (
            <div className="overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg">
              <div className={cn(
                'hidden items-center gap-4 border-b border-divider-subtle px-4 py-3 system-xs-medium-uppercase text-text-tertiary lg:grid',
                GRID_TEMPLATE,
              )}
              >
                <div>{t('deployTab.col.environment')}</div>
                <div>{t('deployTab.col.currentRelease')}</div>
                <div>{t('deployTab.col.status')}</div>
                <div />
              </div>
              {instanceDeployments.map((deployment) => {
                const env = envMap.get(deployment.environmentId)
                if (!env)
                  return null
                const isExpanded = expanded === deployment.id
                const release = releases.find(r => r.id === deployment.activeReleaseId)
                const targetRelease = deployment.targetReleaseId ? releases.find(r => r.id === deployment.targetReleaseId) : undefined
                const failedRelease = deployment.failedReleaseId ? releases.find(r => r.id === deployment.failedReleaseId) : undefined
                const actions = (
                  <div className="flex shrink-0 items-center gap-1" onClick={e => e.stopPropagation()}>
                    <RowPrimaryAction
                      deployment={deployment}
                      onPromote={() => openDeployDrawer({ instanceId, environmentId: deployment.environmentId })}
                      onViewProgress={() => setExpanded(deployment.id)}
                      onViewLogs={() => setExpanded(deployment.id)}
                    />
                    <DeploymentMenu
                      deployment={deployment}
                      onUndeploy={() => undeployDeployment(deployment.id)}
                    />
                  </div>
                )
                const chevron = (
                  <span
                    className={cn(
                      'i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary transition-transform',
                      isExpanded && 'rotate-180',
                    )}
                  />
                )
                return (
                  <div key={deployment.id} className="border-b border-divider-subtle last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggle(deployment.id)}
                      className={cn(
                        'flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-state-base-hover',
                        'lg:grid lg:items-center lg:gap-4',
                        GRID_TEMPLATE,
                      )}
                    >
                      <div className="flex items-start justify-between gap-3 lg:block">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate system-sm-semibold text-text-primary">{env.name}</span>
                          <div className="flex items-center gap-1.5 system-xs-regular text-text-tertiary">
                            <span className="uppercase">{env.backend}</span>
                            <span>·</span>
                            <span>{t(env.mode === 'isolated' ? 'mode.isolated' : 'mode.shared')}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 lg:hidden">
                          {actions}
                          {chevron}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:contents">
                        <div className="flex items-center gap-2">
                          <span className="font-mono system-sm-medium text-text-primary">{deployment.activeReleaseId}</span>
                          {release && (
                            <span className="font-mono system-xs-regular text-text-tertiary">{release.gateCommitId}</span>
                          )}
                        </div>
                        <div>
                          <DeploymentStatusSummary deployment={deployment} />
                        </div>
                      </div>
                      <div className="hidden items-center justify-end gap-1 lg:flex">
                        {actions}
                        {chevron}
                      </div>
                    </button>
                    {isExpanded && (
                      <DeploymentPanel
                        deployment={deployment}
                        env={env}
                        release={release}
                        targetRelease={targetRelease}
                        failedRelease={failedRelease}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}

export default DeployTab
