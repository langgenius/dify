'use client'
import type { FC } from 'react'
import type { AppInfo } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { RiArrowRightUpLine, RiErrorWarningLine, RiExchangeLine, RiRocketLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppPicker } from '../create-instance-modal'
import { StatusBadge } from '../status-badge'
import { useDeploymentsStore } from '../store'
import { useSourceApps } from '../use-source-apps'

type OverviewTabProps = {
  instanceId: string
  onSwitchTab?: (tab: 'deploy' | 'versions' | 'access' | 'settings') => void
}

type SectionProps = {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}

const Section: FC<SectionProps> = ({ title, action, children }) => (
  <div className="flex flex-col gap-3 rounded-xl border border-components-panel-border bg-components-panel-bg p-4">
    <div className="flex items-center justify-between">
      <div className="system-sm-semibold text-text-primary">{title}</div>
      {action}
    </div>
    {children}
  </div>
)

type InfoRowProps = {
  label: string
  value: React.ReactNode
  mono?: boolean
}

const InfoRow: FC<InfoRowProps> = ({ label, value, mono }) => (
  <div className="flex items-start gap-3 py-1.5">
    <span className="w-32 shrink-0 system-xs-regular text-text-tertiary">{label}</span>
    <span className={cn('min-w-0 flex-1 system-sm-regular text-text-primary', mono && 'font-mono')}>{value}</span>
  </div>
)

type SwitchSourceAppDialogProps = {
  open: boolean
  instanceId: string
  currentAppId: string
  apps: AppInfo[]
  isLoading: boolean
  onClose: () => void
}

const SwitchSourceAppDialog: FC<SwitchSourceAppDialogProps> = ({
  open,
  instanceId,
  currentAppId,
  apps,
  isLoading,
  onClose,
}) => {
  const { t } = useTranslation('deployments')
  const switchSourceApp = useDeploymentsStore(state => state.switchSourceApp)
  const [selectedAppId, setSelectedAppId] = useState('')

  const currentAppExists = apps.some(app => app.id === currentAppId)
  const pickerValue = selectedAppId || (currentAppExists ? currentAppId : '')

  const canSwitch = Boolean(pickerValue && pickerValue !== currentAppId)

  const handleSwitch = () => {
    if (!canSwitch)
      return
    switchSourceApp(instanceId, pickerValue)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent className="w-[520px] max-w-[90vw]">
        <DialogCloseButton />
        <div className="flex flex-col gap-5">
          <div>
            <DialogTitle className="title-xl-semi-bold text-text-primary">
              {t('overview.switchSourceApp')}
            </DialogTitle>
            <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
              {t('overview.switchSourceAppDescription')}
            </DialogDescription>
          </div>

          <div className="flex flex-col gap-2">
            <label className="system-xs-medium-uppercase text-text-tertiary">
              {t('createModal.sourceApp')}
            </label>
            <AppPicker
              apps={apps}
              isLoading={isLoading}
              value={pickerValue}
              onChange={setSelectedAppId}
            />
          </div>

          <div className="rounded-lg border border-components-panel-border bg-background-default-subtle px-3 py-2 system-xs-regular text-text-tertiary">
            {t('overview.switchSourceAppHint')}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('createModal.cancel')}
            </Button>
            <Button variant="primary" disabled={!canSwitch} onClick={handleSwitch}>
              {t('overview.switchSourceApp')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type AccessOverviewRowProps = {
  label: string
  enabled: boolean
  hint?: string
}

const AccessOverviewRow: FC<AccessOverviewRowProps> = ({ label, enabled, hint }) => {
  const { t } = useTranslation('deployments')

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 flex-col">
        <span className="system-sm-medium text-text-primary">{label}</span>
        {hint && <span className="truncate system-xs-regular text-text-tertiary">{hint}</span>}
      </div>
      <span className={cn(
        'inline-flex shrink-0 items-center gap-1.5 system-xs-medium',
        enabled ? 'text-util-colors-green-green-700' : 'text-text-tertiary',
      )}
      >
        <span className={cn(
          'h-1.5 w-1.5 rounded-full',
          enabled ? 'bg-util-colors-green-green-500' : 'bg-text-quaternary',
        )}
        />
        {enabled ? t('overview.enabled') : t('overview.disabled')}
      </span>
    </div>
  )
}

const OverviewTab: FC<OverviewTabProps> = ({ instanceId, onSwitchTab }) => {
  const { t } = useTranslation('deployments')
  const instances = useDeploymentsStore(state => state.instances)
  const deployments = useDeploymentsStore(state => state.deployments)
  const environments = useDeploymentsStore(state => state.environments)
  const access = useDeploymentsStore(state => state.access)
  const apiKeys = useDeploymentsStore(state => state.apiKeys)
  const openDeployDrawer = useDeploymentsStore(state => state.openDeployDrawer)
  const [switchSourceOpen, setSwitchSourceOpen] = useState(false)

  const { apps, appMap, isLoading: isLoadingApps } = useSourceApps()
  const instance = instances.find(i => i.id === instanceId)
  const app = instance ? appMap.get(instance.appId) : undefined
  const sourceAppMissing = Boolean(instance && !isLoadingApps && !app)

  const instanceDeployments = useMemo(
    () => deployments.filter(d => d.instanceId === instanceId),
    [deployments, instanceId],
  )
  const instanceAccess = access.find(a => a.instanceId === instanceId)
  const instanceKeys = useMemo(
    () => apiKeys.filter(k => k.instanceId === instanceId),
    [apiKeys, instanceId],
  )

  const envMap = useMemo(
    () => new Map(environments.map(env => [env.id, env])),
    [environments],
  )

  if (!instance)
    return null

  const runAccessEnabled = instanceAccess?.enabled.runAccess ?? false
  const apiAccessEnabled = instanceAccess?.enabled.api ?? false
  const endUserAccessEntries: AccessOverviewRowProps[] = [
    {
      label: t('overview.webapp'),
      enabled: runAccessEnabled && Boolean(instanceAccess?.webappUrl),
      hint: instanceAccess?.webappUrl ?? t('overview.notConfigured'),
    },
    {
      label: t('overview.cli'),
      enabled: runAccessEnabled && Boolean(instanceAccess?.mcpUrl),
      hint: instanceAccess?.mcpUrl ?? t('overview.notConfigured'),
    },
  ]
  const developerAccessEntries: AccessOverviewRowProps[] = [
    {
      label: t('overview.api'),
      enabled: apiAccessEnabled,
      hint: apiAccessEnabled
        ? t('overview.apiKeysCount', { count: instanceKeys.length })
        : t('overview.notConfigured'),
    },
  ]

  const appModeLabel = app
    ? t(`appMode.${app.mode}`, { defaultValue: app.mode })
    : t('overview.sourceAppUnavailable')

  return (
    <>
      <div className="flex flex-col gap-5 p-6">
        {sourceAppMissing && (
          <div className="flex gap-3 rounded-xl border border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 p-4">
            <RiErrorWarningLine className="mt-0.5 h-4 w-4 shrink-0 text-util-colors-warning-warning-700" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="system-sm-semibold text-util-colors-warning-warning-700">
                {t('overview.sourceAppDeletedTitle')}
              </div>
              <div className="system-xs-regular text-text-secondary">
                {t('overview.sourceAppDeletedDescription')}
              </div>
              <button
                type="button"
                onClick={() => setSwitchSourceOpen(true)}
                className="mt-1 flex items-center gap-1 self-start system-xs-medium text-text-accent hover:underline"
              >
                <RiExchangeLine className="h-3 w-3" />
                {t('overview.switchSourceApp')}
              </button>
            </div>
          </div>
        )}

        <Section title={t('overview.basicInfo')}>
          <div className="flex flex-col divide-y divide-divider-subtle">
            <InfoRow label={t('overview.name')} value={instance.name} />
            <InfoRow label={t('overview.description')} value={instance.description ?? t('overview.emptyValue')} />
            <InfoRow
              label={t('overview.sourceApp')}
              value={(
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn('min-w-0 truncate', sourceAppMissing && 'text-util-colors-warning-warning-700')}>
                    {app?.name ?? t('overview.sourceAppDeletedValue')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSwitchSourceOpen(true)}
                    className="inline-flex shrink-0 items-center gap-1 system-xs-medium text-text-accent hover:underline"
                  >
                    <RiExchangeLine className="h-3 w-3" />
                    {t('overview.switchSourceApp')}
                  </button>
                </div>
              )}
            />
            <InfoRow label={t('overview.appMode')} value={appModeLabel} />
            <InfoRow label={t('overview.instanceId')} value={instance.id} mono />
            <InfoRow label={t('overview.created')} value={instance.createdAt} />
          </div>
        </Section>

        <Section
          title={t('overview.deploymentStatus')}
          action={onSwitchTab && (
            <button
              type="button"
              onClick={() => onSwitchTab('deploy')}
              className="flex items-center gap-1 system-xs-medium text-text-accent hover:underline"
            >
              {t('overview.viewDeployments')}
              <RiArrowRightUpLine className="h-3 w-3" />
            </button>
          )}
        >
          {instanceDeployments.length === 0
            ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-8 text-center">
                  <div className="system-sm-regular text-text-tertiary">
                    {t('overview.notDeployedYet')}
                  </div>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => openDeployDrawer({ instanceId })}
                  >
                    <RiRocketLine className="h-3.5 w-3.5" />
                    {t('overview.deploy')}
                  </Button>
                </div>
              )
            : (
                <div className="flex flex-col divide-y divide-divider-subtle">
                  {instanceDeployments.map((deployment) => {
                    const env = envMap.get(deployment.environmentId)
                    if (!env)
                      return null
                    return (
                      <div key={deployment.id} className="flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col">
                            <span className="system-sm-semibold text-text-primary">{env.name}</span>
                            <span className="system-xs-regular text-text-tertiary">
                              {t(env.mode === 'isolated' ? 'mode.isolated' : 'mode.shared')}
                              {' · '}
                              {env.backend.toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono system-sm-regular text-text-secondary">
                            {deployment.activeReleaseId}
                          </span>
                          <StatusBadge status={deployment.status} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
        </Section>

        <Section
          title={t('overview.accessStatus')}
          action={onSwitchTab && (
            <button
              type="button"
              onClick={() => onSwitchTab('access')}
              className="flex items-center gap-1 system-xs-medium text-text-accent hover:underline"
            >
              {t('overview.configureAccess')}
              <RiArrowRightUpLine className="h-3 w-3" />
            </button>
          )}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-lg border border-divider-subtle bg-background-default-subtle p-3">
              <div className="system-xs-semibold text-text-primary">{t('overview.endUserAccess')}</div>
              <div className="flex flex-col divide-y divide-divider-subtle">
                {endUserAccessEntries.map(entry => (
                  <AccessOverviewRow key={entry.label} {...entry} />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-divider-subtle bg-background-default-subtle p-3">
              <div className="system-xs-semibold text-text-primary">{t('overview.developerApi')}</div>
              <div className="flex flex-col divide-y divide-divider-subtle">
                {developerAccessEntries.map(entry => (
                  <AccessOverviewRow key={entry.label} {...entry} />
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>

      <SwitchSourceAppDialog
        open={switchSourceOpen}
        instanceId={instance.id}
        currentAppId={instance.appId}
        apps={apps}
        isLoading={isLoadingApps}
        onClose={() => setSwitchSourceOpen(false)}
      />
    </>
  )
}

export default OverviewTab
