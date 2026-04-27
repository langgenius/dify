'use client'
import type { FC } from 'react'
import type { CredentialBinding, Deployment, Environment, EnvVariable, Instance, Release } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { mockCredentials } from './mock-data'
import { HealthBadge, ModeBadge } from './status-badge'
import { useDeploymentsStore } from './store'

type RequiredBindings = {
  model: string[]
  plugin: string[]
  envVars: { key: string, type: 'string' | 'secret' }[]
}

function deriveRequiredBindings(appId: string): RequiredBindings {
  switch (appId) {
    case 'app-payments-workflow':
      return {
        model: ['OpenAI', 'DeepSeek'],
        plugin: ['Gmail', 'Notion'],
        envVars: [
          { key: 'kn', type: 'string' },
          { key: 'dbkey', type: 'secret' },
        ],
      }
    case 'app-customer-support':
      return {
        model: ['OpenAI'],
        plugin: ['Gmail'],
        envVars: [
          { key: 'dbkey', type: 'secret' },
          { key: 'keyno', type: 'string' },
        ],
      }
    default:
      return {
        model: ['OpenAI'],
        plugin: [],
        envVars: [],
      }
  }
}

type FieldProps = {
  label: string
  hint?: string
  children: React.ReactNode
}

const Field: FC<FieldProps> = ({ label, hint, children }) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <div className="system-xs-medium-uppercase text-text-tertiary">{label}</div>
      {hint && <span className="system-xs-regular text-text-quaternary">{hint}</span>}
    </div>
    {children}
  </div>
)

type SelectOption = { value: string, label: string }

type SelectProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
}

const DeploymentSelect: FC<SelectProps> = ({ value, onChange, options, placeholder }) => {
  const { t } = useTranslation('deployments')
  const selectedOption = useMemo(
    () => options.find(option => option.value === value),
    [options, value],
  )

  return (
    <Select
      value={value || null}
      onValueChange={(next) => {
        if (!next)
          return
        onChange(next)
      }}
      disabled={options.length === 0}
    >
      <SelectTrigger
        className={cn(
          'h-8 border-[0.5px] border-components-input-border-active px-2 system-sm-medium',
          !selectedOption && 'text-text-quaternary',
        )}
      >
        {selectedOption?.label ?? placeholder ?? t('deployDrawer.defaultSelect')}
      </SelectTrigger>
      <SelectContent popupClassName="w-(--anchor-width)">
        {options.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>
            <SelectItemText>{opt.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type LabeledSelectProps = SelectProps & { label: string }

const LabeledSelect: FC<LabeledSelectProps> = ({ label, ...rest }) => (
  <div className="flex items-center gap-2">
    <span className="w-20 shrink-0 system-xs-medium text-text-secondary">{label}</span>
    <div className="min-w-0 flex-1">
      <DeploymentSelect {...rest} />
    </div>
  </div>
)

type EnvironmentRowProps = { env: Environment }

const EnvironmentRow: FC<EnvironmentRowProps> = ({ env }) => (
  <div className="flex items-center justify-between rounded-lg border border-components-panel-border bg-components-panel-bg-blur px-3 py-2">
    <div className="flex items-center gap-2">
      <span className="system-sm-semibold text-text-primary">{env.name}</span>
      <ModeBadge mode={env.mode} />
      <HealthBadge health={env.health} />
    </div>
    <span className="system-xs-regular text-text-tertiary uppercase">{env.backend}</span>
  </div>
)

type DeployFormProps = {
  instance: Instance
  environments: Environment[]
  releases: Release[]
  deployments: Deployment[]
  lockedEnvId?: string
  presetReleaseId?: string
  onCancel: () => void
  onSubmit: (params: {
    environmentId: string
    releaseId?: string
    releaseNote?: string
    credentials: CredentialBinding[]
    envVariables: EnvVariable[]
  }) => void
}

const DeployForm: FC<DeployFormProps> = ({
  instance,
  environments,
  releases,
  deployments,
  lockedEnvId,
  presetReleaseId,
  onCancel,
  onSubmit,
}) => {
  const { t } = useTranslation('deployments')
  const bindingProfileId = instance.bindingProfileId ?? instance.appId
  const required = useMemo(() => deriveRequiredBindings(bindingProfileId), [bindingProfileId])

  const credentialsByProvider = useMemo(() => {
    const map = new Map<string, typeof mockCredentials>()
    mockCredentials.forEach((c) => {
      const list = map.get(c.provider) ?? []
      list.push(c)
      map.set(c.provider, list)
    })
    return map
  }, [])

  const presetRelease = useMemo(
    () => presetReleaseId ? releases.find(r => r.id === presetReleaseId) : undefined,
    [releases, presetReleaseId],
  )
  const isPromote = Boolean(presetRelease)

  const existingDeployment = useMemo(
    () => lockedEnvId
      ? deployments.find(d => d.instanceId === instance.id && d.environmentId === lockedEnvId)
      : undefined,
    [deployments, instance.id, lockedEnvId],
  )

  const [selectedEnvId, setSelectedEnvId] = useState<string>(
    () => lockedEnvId ?? environments[0]?.id ?? '',
  )
  const [releaseNote, setReleaseNote] = useState<string>('')
  const [modelCredentials, setModelCredentials] = useState<Record<string, string>>(() => {
    const model: Record<string, string> = {}
    required.model.forEach((provider) => {
      const existing = existingDeployment?.credentials.find(c => c.kind === 'model' && c.provider === provider)
      const first = credentialsByProvider.get(provider)?.[0]
      model[provider] = existing?.credentialId ?? first?.id ?? ''
    })
    return model
  })
  const [pluginCredentials, setPluginCredentials] = useState<Record<string, string>>(() => {
    const plugin: Record<string, string> = {}
    required.plugin.forEach((provider) => {
      const existing = existingDeployment?.credentials.find(c => c.kind === 'plugin' && c.provider === provider)
      const first = credentialsByProvider.get(provider)?.[0]
      plugin[provider] = existing?.credentialId ?? first?.id ?? ''
    })
    return plugin
  })
  const [envValues, setEnvValues] = useState<Record<string, string>>(() => {
    const env: Record<string, string> = {}
    required.envVars.forEach((v) => {
      const existing = existingDeployment?.envVariables.find(e => e.key === v.key)
      env[v.key] = existing?.value ?? ''
    })
    return env
  })

  const canDeploy = Boolean(
    selectedEnvId
    && required.model.every(p => modelCredentials[p])
    && required.plugin.every(p => pluginCredentials[p])
    && required.envVars.every(v => envValues[v.key]?.length),
  )

  const lockedEnv = lockedEnvId ? environments.find(e => e.id === lockedEnvId) : undefined

  const handleDeploy = () => {
    if (!canDeploy)
      return
    const credentials: CredentialBinding[] = [
      ...required.model.map<CredentialBinding>(provider => ({
        provider,
        kind: 'model',
        credentialId: modelCredentials[provider],
      })),
      ...required.plugin.map<CredentialBinding>(provider => ({
        provider,
        kind: 'plugin',
        credentialId: pluginCredentials[provider],
      })),
    ]
    const envVariables: EnvVariable[] = required.envVars.map<EnvVariable>(v => ({
      key: v.key,
      value: envValues[v.key] ?? '',
      type: v.type,
    }))
    onSubmit({
      environmentId: selectedEnvId,
      releaseId: presetRelease?.id,
      releaseNote: isPromote ? undefined : releaseNote,
      credentials,
      envVariables,
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {isPromote ? t('deployDrawer.promoteTitle') : t('deployDrawer.title')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {isPromote ? t('deployDrawer.promoteDescription') : t('deployDrawer.description')}
        </DialogDescription>
      </div>

      <Field label={isPromote ? t('deployDrawer.releaseLabel') : t('deployDrawer.noteLabel')}>
        {isPromote && presetRelease
          ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between rounded-lg border border-components-panel-border bg-components-panel-bg-blur px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono system-sm-semibold text-text-primary">{presetRelease.id}</span>
                    <span className="shrink-0 system-xs-regular text-text-tertiary">·</span>
                    <span className="shrink-0 font-mono system-xs-regular text-text-tertiary">{presetRelease.gateCommitId}</span>
                    {presetRelease.description && (
                      <>
                        <span className="shrink-0 system-xs-regular text-text-tertiary">·</span>
                        <span className="truncate system-xs-regular text-text-secondary">{presetRelease.description}</span>
                      </>
                    )}
                  </div>
                  <span className="shrink-0 system-xs-regular text-text-quaternary">{presetRelease.createdAt}</span>
                </div>
                <span className="system-xs-regular text-text-tertiary">
                  {t('deployDrawer.existingReleaseHint')}
                </span>
              </div>
            )
          : (
              <div className="flex flex-col gap-2">
                <Input
                  value={releaseNote}
                  onChange={e => setReleaseNote(e.target.value)}
                  placeholder={t('deployDrawer.notePlaceholder')}
                  maxLength={80}
                />
                <span className="system-xs-regular text-text-tertiary">
                  {t('deployDrawer.newReleaseHint')}
                </span>
              </div>
            )}
      </Field>

      <Field
        label={t('deployDrawer.targetEnv')}
        hint={lockedEnvId ? t('deployDrawer.lockedHint') : undefined}
      >
        {lockedEnv
          ? <EnvironmentRow env={lockedEnv} />
          : (
              <DeploymentSelect
                value={selectedEnvId}
                onChange={setSelectedEnvId}
                options={environments.map(env => ({
                  value: env.id,
                  label: `${env.name} · ${t(env.mode === 'isolated' ? 'mode.isolated' : 'mode.shared')} · ${env.backend.toUpperCase()}`,
                }))}
                placeholder={t('deployDrawer.selectEnv')}
              />
            )}
      </Field>

      {(required.model.length > 0 || required.plugin.length > 0) && (
        <div className="flex flex-col gap-4">
          <div className="system-xs-medium-uppercase text-text-tertiary">{t('deployDrawer.runtimeCredentials')}</div>
          {required.model.length > 0 && (
            <Field label={t('deployDrawer.modelCreds')}>
              <div className="flex flex-col gap-2">
                {required.model.map((provider) => {
                  const providerCreds = credentialsByProvider.get(provider) ?? []
                  return (
                    <LabeledSelect
                      key={provider}
                      label={provider}
                      value={modelCredentials[provider] ?? ''}
                      onChange={v => setModelCredentials(prev => ({ ...prev, [provider]: v }))}
                      options={providerCreds.map(c => ({
                        value: c.id,
                        label: `${c.name}${c.validated ? '' : t('deployDrawer.needsValidation')}`,
                      }))}
                      placeholder={t('deployDrawer.selectProviderKey', { provider })}
                    />
                  )
                })}
              </div>
            </Field>
          )}

          {required.plugin.length > 0 && (
            <Field label={t('deployDrawer.pluginCreds')}>
              <div className="flex flex-col gap-2">
                {required.plugin.map((provider) => {
                  const providerCreds = credentialsByProvider.get(provider) ?? []
                  return (
                    <LabeledSelect
                      key={provider}
                      label={provider}
                      value={pluginCredentials[provider] ?? ''}
                      onChange={v => setPluginCredentials(prev => ({ ...prev, [provider]: v }))}
                      options={providerCreds.map(c => ({ value: c.id, label: c.name }))}
                      placeholder={t('deployDrawer.selectProviderCred', { provider })}
                    />
                  )
                })}
              </div>
            </Field>
          )}
        </div>
      )}

      {required.envVars.length > 0 && (
        <Field label={t('deployDrawer.envVars')}>
          <div className="flex flex-col gap-2">
            {required.envVars.map(v => (
              <div key={v.key} className="flex items-center gap-2">
                <span className="w-16 shrink-0 system-xs-medium text-text-secondary">{v.key}</span>
                <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border-[0.5px] border-components-input-border-active bg-components-input-bg-normal px-2">
                  <input
                    type={v.type === 'secret' ? 'password' : 'text'}
                    value={envValues[v.key] ?? ''}
                    placeholder={v.type === 'secret' ? t('deployDrawer.secretPlaceholder') : t('deployDrawer.valuePlaceholder')}
                    onChange={e => setEnvValues(prev => ({ ...prev, [v.key]: e.target.value }))}
                    className={cn('min-w-0 flex-1 bg-transparent text-[13px] text-text-secondary outline-hidden placeholder:text-text-quaternary')}
                  />
                  <span className="shrink-0 rounded-md border border-divider-subtle px-1.5 text-[10px] font-medium text-text-tertiary uppercase">
                    {v.type}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Field>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('deployDrawer.cancel')}
        </Button>
        <Button variant="primary" disabled={!canDeploy} onClick={handleDeploy}>
          {isPromote ? t('deployDrawer.promote') : t('deployDrawer.deploy')}
        </Button>
      </div>
    </div>
  )
}

const DeployDrawer: FC = () => {
  const { t } = useTranslation('deployments')
  const drawer = useDeploymentsStore(state => state.deployDrawer)
  const environments = useDeploymentsStore(state => state.environments)
  const instances = useDeploymentsStore(state => state.instances)
  const releases = useDeploymentsStore(state => state.releases)
  const deployments = useDeploymentsStore(state => state.deployments)
  const closeDeployDrawer = useDeploymentsStore(state => state.closeDeployDrawer)
  const startDeploy = useDeploymentsStore(state => state.startDeploy)

  const open = drawer.open
  const instance = instances.find(i => i.id === drawer.instanceId)
  const formKey = `${drawer.instanceId ?? 'none'}-${drawer.environmentId ?? 'any'}-${drawer.releaseId ?? 'new'}-${open ? '1' : '0'}`

  return (
    <Dialog
      open={open}
      onOpenChange={next => !next && closeDeployDrawer()}
    >
      <DialogContent className="w-[560px] max-w-[90vw]">
        <DialogCloseButton />
        {!instance
          ? <div className="p-4 text-text-tertiary">{t('deployDrawer.notFound')}</div>
          : (
              <DeployForm
                key={formKey}
                instance={instance}
                environments={environments}
                releases={releases}
                deployments={deployments}
                lockedEnvId={drawer.environmentId}
                presetReleaseId={drawer.releaseId}
                onCancel={closeDeployDrawer}
                onSubmit={({ environmentId, releaseId, releaseNote, credentials, envVariables }) =>
                  startDeploy({
                    instanceId: instance.id,
                    environmentId,
                    releaseId,
                    releaseNote,
                    credentials,
                    envVariables,
                  })}
              />
            )}
      </DialogContent>
    </Dialog>
  )
}

export default DeployDrawer
