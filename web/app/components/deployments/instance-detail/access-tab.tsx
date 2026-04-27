'use client'
import type { FC, ReactNode } from 'react'
import type { AccessPermissionKind, EnvAccessPermission, Environment } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeploymentsStore } from '../store'

type SectionProps = {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}

const Section: FC<SectionProps> = ({ title, description, action, children }) => (
  <div className="flex flex-col gap-3 rounded-xl border border-components-panel-border bg-components-panel-bg p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="system-sm-semibold text-text-primary">{title}</div>
        {description && (
          <p className="mt-1 max-w-xl system-xs-regular text-text-tertiary">{description}</p>
        )}
      </div>
      {action}
    </div>
    {children}
  </div>
)

type CopyPillProps = {
  label: string
  value: string
  prefix?: ReactNode
  className?: string
}

const CopyPill: FC<CopyPillProps> = ({ label, value, prefix, className }) => {
  const { t } = useTranslation('deployments')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(t('access.copyToast'))
      window.setTimeout(() => setCopied(false), 1500)
    }
    catch {
      toast.error(t('access.copyFailed'))
    }
  }

  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal pr-1 pl-1.5',
        className,
      )}
    >
      <div className="mr-0.5 flex h-5 shrink-0 items-center rounded-md border border-divider-subtle px-1.5 text-[11px] font-medium text-text-tertiary">
        {label}
      </div>
      {prefix}
      <div className="min-w-0 flex-1 truncate px-1 font-mono text-[13px] font-medium text-text-secondary">
        {value}
      </div>
      <div className="mx-1 h-[14px] w-px shrink-0 bg-divider-regular" />
      <button
        type="button"
        onClick={handleCopy}
        aria-label={t('access.copy')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
      >
        <span className={cn(copied ? 'i-ri-check-line' : 'i-ri-file-copy-line', 'h-3.5 w-3.5')} />
      </button>
    </div>
  )
}

type ApiKeyRowProps = {
  label: string
  envName: string
  value: string
  onRevoke: () => void
}

const ApiKeyRow: FC<ApiKeyRowProps> = ({ label, envName, value, onRevoke }) => {
  const { t } = useTranslation('deployments')
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  const displayValue = visible ? value : `${value.slice(0, 6)}${'•'.repeat(14)}${value.slice(-4)}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(t('access.copyToast'))
      window.setTimeout(() => setCopied(false), 1500)
    }
    catch {
      toast.error(t('access.copyFailed'))
    }
  }

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex min-w-[140px] flex-col">
        <span className="system-sm-medium text-text-primary">{label}</span>
        <span className="system-xs-regular text-text-tertiary">
          {t('access.api.envPrefix', { env: envName })}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal pr-1 pl-2">
        <div className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-text-secondary">
          {displayValue}
        </div>
        <button
          type="button"
          onClick={() => setVisible(prev => !prev)}
          aria-label={visible ? t('access.hide') : t('access.show')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        >
          <span className={cn(visible ? 'i-ri-eye-off-line' : 'i-ri-eye-line', 'h-3.5 w-3.5')} />
        </button>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={t('access.copy')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        >
          <span className={cn(copied ? 'i-ri-check-line' : 'i-ri-file-copy-line', 'h-3.5 w-3.5')} />
        </button>
        <button
          type="button"
          onClick={onRevoke}
          aria-label={t('access.revoke')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
        >
          <span className="i-ri-delete-bin-line h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

const permissionIcon: Record<AccessPermissionKind, string> = {
  organization: 'i-ri-team-line',
  specific: 'i-ri-lock-line',
  external: 'i-ri-user-line',
  anyone: 'i-ri-global-line',
}

const permissionOrder: AccessPermissionKind[] = ['organization', 'specific', 'external', 'anyone']

type PermissionPickerProps = {
  value: AccessPermissionKind
  disabled?: boolean
  onChange: (kind: AccessPermissionKind) => void
}

const PermissionPicker: FC<PermissionPickerProps> = ({ value, disabled, onChange }) => {
  const { t } = useTranslation('deployments')
  const icon = permissionIcon[value]
  const label = t(`access.permission.${value}`)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          'inline-flex h-8 min-w-[220px] items-center gap-2 rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal px-2.5 system-sm-regular text-text-secondary hover:bg-state-base-hover',
          disabled && 'opacity-50',
        )}
      >
        <span className={cn(icon, 'h-4 w-4 shrink-0 text-text-tertiary')} />
        <span className="flex-1 truncate text-left">{label}</span>
        <span className="i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary" />
      </DropdownMenuTrigger>
      <DropdownMenuContent placement="bottom-start" popupClassName="w-[340px] p-1">
        {permissionOrder.map((kind) => {
          const itemIcon = permissionIcon[kind]
          const isSelected = kind === value
          return (
            <DropdownMenuItem
              key={kind}
              onSelect={() => onChange(kind)}
              className="mx-0 h-auto items-start gap-3 rounded-lg px-2.5 py-2"
            >
              <span className={cn(itemIcon, 'mt-0.5 h-4 w-4 shrink-0 text-text-tertiary')} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate system-sm-medium text-text-primary">
                    {t(`access.permission.${kind}`)}
                  </span>
                </div>
                <span className="system-xs-regular text-text-tertiary">
                  {t(`access.permission.${kind}Desc`)}
                </span>
              </div>
              {isSelected && (
                <span className="mt-0.5 i-ri-check-line h-4 w-4 shrink-0 text-text-accent" />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type EndpointRowProps = {
  envName: string
  label: string
  value: string
  openLabel?: string
}

const EndpointRow: FC<EndpointRowProps> = ({ envName, label, value, openLabel }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
    <span className="min-w-[140px] system-xs-regular text-text-tertiary">
      {envName}
    </span>
    <CopyPill label={label} value={value} className="min-w-[260px] flex-1" />
    {openLabel && (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover"
      >
        <span className="i-ri-external-link-line h-3.5 w-3.5" />
        {openLabel}
      </a>
    )}
  </div>
)

type ApiKeyGenerateMenuProps = {
  environments: Environment[]
  onGenerate: (environmentId: string) => void
}

const ApiKeyGenerateMenu: FC<ApiKeyGenerateMenuProps> = ({ environments, onGenerate }) => {
  const { t } = useTranslation('deployments')
  const [open, setOpen] = useState(false)
  const disabled = environments.length === 0

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 system-sm-medium',
          'border border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-text',
          'hover:bg-components-button-secondary-bg-hover',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className="i-ri-add-line h-3.5 w-3.5" />
        {t('access.api.newKey')}
        <span className="i-ri-arrow-down-s-line h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      {open && !disabled && (
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-[220px]">
          {environments.map(env => (
            <DropdownMenuItem
              key={env.id}
              className="gap-2 px-3"
              onClick={() => {
                setOpen(false)
                onGenerate(env.id)
              }}
            >
              <span className="system-sm-regular text-text-secondary">
                {t('access.api.newKeyForEnv', { env: env.name })}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}

function getUrlOrigin(url?: string) {
  if (!url)
    return undefined
  try {
    return new URL(url).origin
  }
  catch {
    return url
  }
}

type AccessTabProps = {
  instanceId: string
}

const AccessTab: FC<AccessTabProps> = ({ instanceId }) => {
  const { t } = useTranslation('deployments')
  const instances = useDeploymentsStore(state => state.instances)
  const environments = useDeploymentsStore(state => state.environments)
  const deployments = useDeploymentsStore(state => state.deployments)
  const apiKeys = useDeploymentsStore(state => state.apiKeys)
  const access = useDeploymentsStore(state => state.access)
  const generateApiKey = useDeploymentsStore(state => state.generateApiKey)
  const revokeApiKey = useDeploymentsStore(state => state.revokeApiKey)
  const toggleAccessMethod = useDeploymentsStore(state => state.toggleAccessMethod)
  const setEnvAccessPermission = useDeploymentsStore(state => state.setEnvAccessPermission)

  const instance = instances.find(i => i.id === instanceId)
  const instanceAccess = access.find(a => a.instanceId === instanceId)

  const instanceDeployments = useMemo(
    () => deployments.filter(d => d.instanceId === instanceId),
    [deployments, instanceId],
  )

  const envMap = useMemo(
    () => new Map(environments.map(env => [env.id, env])),
    [environments],
  )

  const instanceKeys = useMemo(
    () => apiKeys.filter(k => k.instanceId === instanceId),
    [apiKeys, instanceId],
  )

  const deployedEnvs = useMemo(
    () => instanceDeployments
      .map(deployment => envMap.get(deployment.environmentId))
      .filter((env): env is Environment => !!env),
    [envMap, instanceDeployments],
  )

  const permissionByEnv = useMemo(() => {
    const map = new Map<string, EnvAccessPermission>()
    instanceAccess?.envPermissions.forEach((p) => {
      map.set(p.environmentId, p)
    })
    return map
  }, [instanceAccess])

  if (!instance || !instanceAccess)
    return null

  const apiEnabled = instanceAccess.enabled.api
  const runEnabled = instanceAccess.enabled.runAccess
  const cliDomain = getUrlOrigin(instanceAccess.mcpUrl)
  const cliDocsUrl = cliDomain ? `${cliDomain}/cli` : undefined

  return (
    <div className="flex flex-col gap-5 p-6">
      <Section
        title={t('access.permissions.title')}
        description={t('access.permissions.description')}
      >
        {deployedEnvs.length === 0
          ? (
              <div className="rounded-lg border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-6 text-center system-sm-regular text-text-tertiary">
                {t('access.runAccess.noEnvs')}
              </div>
            )
          : (
              <div className="flex flex-col gap-3">
                {deployedEnvs.map((env) => {
                  const current = permissionByEnv.get(env.id)
                  const kind = current?.kind ?? 'organization'
                  return (
                    <div
                      key={env.id}
                      className="flex flex-col gap-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="min-w-[140px] system-xs-regular text-text-tertiary">
                          {env.name}
                        </span>
                        <PermissionPicker
                          value={kind}
                          onChange={next => setEnvAccessPermission(instanceId, env.id, next)}
                        />
                      </div>
                      {kind === 'specific' && (
                        <div className="pl-0 system-xs-regular text-text-tertiary sm:pl-[152px]">
                          {t('access.permission.specificUnavailable')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
      </Section>

      <Section
        title={t('access.channels.title')}
        description={t('access.channels.description')}
        action={(
          <Switch
            checked={runEnabled}
            onCheckedChange={v => toggleAccessMethod(instanceId, 'runAccess', v)}
          />
        )}
      >
        {runEnabled
          ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
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
                    {instanceAccess.webappUrl && deployedEnvs.length > 0
                      ? (
                          <div className="flex flex-col gap-2">
                            {deployedEnvs.map(env => (
                              <EndpointRow
                                key={`webapp-${env.id}`}
                                envName={env.name}
                                label={t('access.runAccess.urlLabel')}
                                value={instanceAccess.webappUrl!}
                                openLabel={t('access.runAccess.openWebapp')}
                              />
                            ))}
                          </div>
                        )
                      : (
                          <div className="rounded-lg border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-6 text-center system-sm-regular text-text-tertiary">
                            {t('access.runAccess.webappEmpty')}
                          </div>
                        )}
                  </div>
                  <div className="flex flex-col gap-1.5 border-t border-divider-subtle pt-3">
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
                              className="min-w-[260px] flex-1"
                            />
                            <a
                              href={cliDocsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover"
                            >
                              <span className="i-ri-download-cloud-2-line h-3.5 w-3.5" />
                              {t('access.cli.install')}
                            </a>
                            <a
                              href={cliDocsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover"
                            >
                              <span className="i-ri-book-open-line h-3.5 w-3.5" />
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

      <Section
        title={t('access.api.developerTitle')}
        description={t('access.api.description')}
        action={(
          <Switch
            checked={apiEnabled}
            onCheckedChange={v => toggleAccessMethod(instanceId, 'api', v)}
          />
        )}
      >
        {apiEnabled
          ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="system-sm-medium text-text-primary">
                      {t('access.api.backendTitle')}
                    </span>
                    <span className="system-xs-regular text-text-tertiary">
                      {t('access.api.keyList')}
                    </span>
                  </div>
                  <ApiKeyGenerateMenu
                    environments={deployedEnvs}
                    onGenerate={environmentId => generateApiKey(instanceId, environmentId)}
                  />
                </div>
                {instanceKeys.length === 0
                  ? (
                      <div className="rounded-lg border border-dashed border-components-panel-border bg-components-panel-bg-blur px-4 py-6 text-center system-sm-regular text-text-tertiary">
                        {deployedEnvs.length === 0
                          ? t('access.api.empty')
                          : t('access.api.noKeys')}
                      </div>
                    )
                  : (
                      <div className="flex flex-col divide-y divide-divider-subtle">
                        {instanceKeys.map((k) => {
                          const env = envMap.get(k.environmentId)
                          return (
                            <ApiKeyRow
                              key={k.id}
                              label={k.label}
                              envName={env?.name ?? k.environmentId}
                              value={k.value}
                              onRevoke={() => revokeApiKey(k.id)}
                            />
                          )
                        })}
                      </div>
                    )}
              </div>
            )
          : (
              <div className="system-xs-regular text-text-tertiary">
                {t('access.api.disabled')}
              </div>
            )}
      </Section>
    </div>
  )
}

export default AccessTab
