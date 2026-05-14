'use client'

import type { EnvironmentDeployment, ReleaseRuntimeBinding } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useTranslation } from 'react-i18next'
import { useClipboard } from '@/hooks/use-clipboard'
import { environmentBackend, environmentMode } from '../../environment'
import { formatDate } from '../../release'
import {
  isRuntimeEnvVarBinding,
  isRuntimeModelBinding,
  isRuntimePluginBinding,
  runtimeBindingSummary,
} from '../../runtime-bindings'

type DetailItemProps = {
  label: string
  children: ReactNode
  mono?: boolean
  copyValue?: string
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation('deployments')
  const { copied, copy } = useClipboard({
    onCopyError: () => toast.error(t('access.copyFailed')),
  })
  return (
    <button
      type="button"
      aria-label={t('access.copy')}
      className="flex size-5 shrink-0 items-center justify-center rounded-md text-text-quaternary opacity-0 transition group-hover:opacity-100 hover:bg-state-base-hover hover:text-text-tertiary focus:opacity-100"
      onClick={() => {
        copy(value)
        if (!copied)
          toast.success(t('access.copyToast'))
      }}
    >
      <span aria-hidden className={cn(copied ? 'i-ri-check-line' : 'i-ri-file-copy-line', 'size-3.5')} />
    </button>
  )
}

function DetailItem({ label, children, mono, copyValue }: DetailItemProps) {
  const canCopy = mono && typeof copyValue === 'string' && copyValue.length > 0 && copyValue !== '—'
  return (
    <div className="group grid min-w-0 grid-cols-[112px_minmax(0,1fr)] items-start gap-3">
      <dt className="system-xs-regular text-text-tertiary">{label}</dt>
      <dd className={cn('min-w-0 system-sm-regular break-words text-text-primary', mono && 'flex items-start gap-1.5 font-mono break-all')}>
        <span className="min-w-0 grow break-words">{children}</span>
        {canCopy && <CopyButton value={copyValue} />}
      </dd>
    </div>
  )
}

function DetailGroup({ title, children }: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="min-w-0">
      <h3 className="system-xs-medium-uppercase text-text-tertiary">{title}</h3>
      <dl className="mt-2.5 flex min-w-0 flex-col gap-2.5">
        {children}
      </dl>
    </section>
  )
}

function RuntimeBindingItem({ binding }: {
  binding: ReleaseRuntimeBinding
}) {
  const summary = runtimeBindingSummary(binding)

  return (
    <div className="min-w-0">
      <span className="inline-flex max-w-full rounded-md bg-state-base-hover px-1.5 py-0.5 font-mono system-xs-regular text-text-secondary" title={summary}>
        {summary}
      </span>
    </div>
  )
}

export function DeploymentPanel({ row }: {
  row: EnvironmentDeployment
}) {
  const { t } = useTranslation('deployments')
  const observed = row.currentRelease
  const env = row.environment
  const runtime = row.runtime
  const endpoints = runtime?.endpoints
  const detailBindings = runtime?.bindings ?? []
  const modelCredentials = detailBindings.filter(isRuntimeModelBinding)
  const pluginCredentials = detailBindings.filter(isRuntimePluginBinding)
  const envVars = detailBindings.filter(isRuntimeEnvVarBinding)
  const runtimeMode = `${t(environmentMode(env) === 'isolated' ? 'mode.isolated' : 'mode.shared')} / ${environmentBackend(env).toUpperCase()}`
  const hasRuntimeBindings = modelCredentials.length > 0 || pluginCredentials.length > 0 || envVars.length > 0
  const showFailureBanner = row.status?.toLowerCase().includes('fail')
  const deploymentId = runtime?.currentDeploymentId ?? runtime?.runtimeInstanceId

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
      <DetailGroup title={t('deployTab.panel.instanceInfo')}>
        <DetailItem label={t('deployTab.panel.deploymentId')} mono copyValue={deploymentId ?? undefined}>
          {deploymentId || '—'}
        </DetailItem>
        <DetailItem label={t('deployTab.panel.releaseCreatedAt')}>{formatDate(observed?.createdAt)}</DetailItem>
      </DetailGroup>

      <DetailGroup title={t('deployTab.panel.runtimeInfo')}>
        <DetailItem label={t('deployTab.panel.replicas')}>{runtime?.replicas != null ? String(runtime.replicas) : '—'}</DetailItem>
        <DetailItem label={t('deployTab.panel.runtimeMode')}>{runtimeMode}</DetailItem>
        <DetailItem label={t('deployTab.panel.runtimeNote')}>{row.status ?? '—'}</DetailItem>
        {hasRuntimeBindings && (
          <DetailItem label={t('deployTab.panel.runtimeBindings')}>
            <div className="flex min-w-0 flex-wrap gap-1">
              {modelCredentials.map(c => (
                <RuntimeBindingItem
                  key={`${c.kind}-${c.name}-${c.displayValue}`}
                  binding={c}
                />
              ))}
              {pluginCredentials.map(c => (
                <RuntimeBindingItem
                  key={`${c.kind}-${c.name}-${c.displayValue}`}
                  binding={c}
                />
              ))}
              {envVars.map(v => (
                <RuntimeBindingItem
                  key={`${v.kind}-${v.name}-${v.displayValue}`}
                  binding={v}
                />
              ))}
            </div>
          </DetailItem>
        )}
      </DetailGroup>

      <DetailGroup title={t('deployTab.panel.endpoints')}>
        <DetailItem label={t('deployTab.panel.run')} mono copyValue={endpoints?.run ?? undefined}>
          {endpoints?.run ?? '—'}
        </DetailItem>
        <DetailItem label={t('deployTab.panel.health')} mono copyValue={endpoints?.health ?? undefined}>
          {endpoints?.health ?? '—'}
        </DetailItem>
      </DetailGroup>

      {showFailureBanner && (
        <div className="border-l-2 border-util-colors-red-red-500 bg-util-colors-red-red-50 px-3 py-2 system-xs-regular text-util-colors-red-red-700 xl:col-span-3">
          {row.status}
        </div>
      )}
    </div>
  )
}
