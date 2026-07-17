'use client'

import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type { ContactImProviderDefinition } from './types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContactImBindingDialog } from './binding-dialog'
import {
  useContactImIntegration,
  useContactImProviderDefinitions,
  useDisconnectContactImProvider,
  useTestContactImConnection,
} from './hooks'
import { ContactImProviderCard } from './provider-card'
import { ContactImSyncDetailsDialog } from './sync-details-dialog'
import { useContactImSyncRunUrlState } from './sync-run-url-state'
import { ContactImDirectorySyncSection } from './sync-section'
import {
  ContactImConnectionStatus,
  ContactImProvider,
  ContactImProviderAvailability,
  ContactImStatusReason,
  ContactImUnavailableReason,
} from './types'

const statusTones = {
  [ContactImConnectionStatus.CallbackError]: 'error',
  [ContactImConnectionStatus.Configured]: 'normal',
  [ContactImConnectionStatus.Connected]: 'success',
  [ContactImConnectionStatus.ConnectionError]: 'error',
  [ContactImConnectionStatus.NotConfigured]: 'disabled',
  [ContactImConnectionStatus.PermissionIssue]: 'warning',
} satisfies Record<ContactImConnectionStatus, StatusDotStatus>

type BindingTarget = {
  provider: ContactImProviderDefinition
  replaceActiveProvider: boolean
}

export function ContactsImPlatformManagementSurface() {
  const { t, i18n } = useTranslation('contacts')
  const { t: tCommon } = useTranslation('common')
  const integrationQuery = useContactImIntegration()
  const providersQuery = useContactImProviderDefinitions()
  const testConnection = useTestContactImConnection()
  const disconnectProvider = useDisconnectContactImProvider()
  const [bindingTarget, setBindingTarget] = useState<BindingTarget | null>(null)
  const [replacementProvider, setReplacementProvider] =
    useState<ContactImProviderDefinition | null>(null)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [syncRunId, setSyncRunId] = useContactImSyncRunUrlState()

  if (integrationQuery.isPending || providersQuery.isPending) {
    return (
      <div
        role="status"
        aria-label={t(($) => $['imPlatform.loading'])}
        className="max-w-[760px] space-y-3"
      >
        <div className="h-5 w-40 animate-pulse rounded-md bg-state-base-active motion-reduce:animate-none" />
        <div className="h-4 w-3/4 animate-pulse rounded-md bg-state-base-active motion-reduce:animate-none" />
        <div className="h-16 w-full animate-pulse rounded-xl bg-state-base-active motion-reduce:animate-none" />
      </div>
    )
  }

  if (integrationQuery.isError || providersQuery.isError) {
    return (
      <div
        role="alert"
        className="max-w-[760px] rounded-xl border border-divider-subtle bg-background-default-subtle p-5"
      >
        <div className="system-md-semibold text-text-primary">
          {t(($) => $['imPlatform.loadError.title'])}
        </div>
        <div className="mt-1 system-sm-regular text-text-tertiary">
          {t(($) => $['imPlatform.loadError.description'])}
        </div>
        <Button
          className="mt-4"
          onClick={() => {
            void integrationQuery.refetch()
            void providersQuery.refetch()
          }}
        >
          {t(($) => $['imPlatform.loadError.retry'])}
        </Button>
      </div>
    )
  }

  const integration = integrationQuery.data
  const providers = providersQuery.data
  const activeProvider = providers.find((provider) => provider.provider === integration.provider)
  const statusLabels = {
    [ContactImConnectionStatus.CallbackError]: t(($) => $['imPlatform.status.callback_error']),
    [ContactImConnectionStatus.Configured]: t(($) => $['imPlatform.status.configured']),
    [ContactImConnectionStatus.Connected]: t(($) => $['imPlatform.status.connected']),
    [ContactImConnectionStatus.ConnectionError]: t(($) => $['imPlatform.status.connection_error']),
    [ContactImConnectionStatus.NotConfigured]: t(($) => $['imPlatform.status.not_configured']),
    [ContactImConnectionStatus.PermissionIssue]: t(($) => $['imPlatform.status.permission_issue']),
  }
  const statusReasonLabels = {
    [ContactImStatusReason.CallbackMismatch]: t(
      ($) => $['imPlatform.statusReason.callback_mismatch'],
    ),
    [ContactImStatusReason.MissingDirectoryPermission]: t(
      ($) => $['imPlatform.statusReason.missing_directory_permission'],
    ),
    [ContactImStatusReason.ProviderRequestFailed]: t(
      ($) => $['imPlatform.statusReason.provider_request_failed'],
    ),
  }
  const providerDescriptions = {
    [ContactImProvider.DingTalk]: t(($) => $['imPlatform.provider.dingtalkDescription']),
    [ContactImProvider.Feishu]: t(($) => $['imPlatform.provider.feishuDescription']),
    [ContactImProvider.Slack]: t(($) => $['imPlatform.provider.slackDescription']),
  }
  const unavailableReasonLabels = {
    [ContactImUnavailableReason.DeploymentUnsupported]: t(
      ($) => $['imPlatform.provider.unavailableReason.deployment_unsupported'],
    ),
    [ContactImUnavailableReason.NotReleased]: t(
      ($) => $['imPlatform.provider.unavailableReason.not_released'],
    ),
  }
  const currentStatusLabel = statusLabels[integration.status]
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  const diagnosticsText = integration.statusReason
    ? statusReasonLabels[integration.statusReason]
    : integration.status === ContactImConnectionStatus.Connected
      ? t(($) => $['imPlatform.diagnostics.connected'])
      : integration.status === ContactImConnectionStatus.Configured
        ? t(($) => $['imPlatform.diagnostics.configured'])
        : t(($) => $['imPlatform.diagnostics.notConfigured'])

  const openProvider = (provider: ContactImProviderDefinition) => {
    if (
      provider.availability !== ContactImProviderAvailability.Available ||
      !integration.canManage
    ) {
      return
    }

    if (integration.provider && integration.provider !== provider.provider) {
      setReplacementProvider(provider)
      return
    }

    setBindingTarget({
      provider,
      replaceActiveProvider: false,
    })
  }

  const renderProviderCard = (
    provider: ContactImProviderDefinition,
    action: 'configure' | 'connect' | 'replace',
  ) => {
    const unavailable = provider.availability === ContactImProviderAvailability.Unavailable
    const actionLabel = unavailable
      ? t(($) => $['imPlatform.provider.unavailable'])
      : action === 'configure'
        ? t(($) => $['imPlatform.action.configure'])
        : action === 'replace'
          ? t(($) => $['imPlatform.action.replace'])
          : t(($) => $['imPlatform.action.connect'])
    const unavailableReason = provider.unavailableReason
      ? unavailableReasonLabels[provider.unavailableReason]
      : undefined

    return (
      <ContactImProviderCard
        key={provider.provider}
        actionAriaLabel={
          action === 'configure' ? actionLabel : `${provider.displayName} — ${actionLabel}`
        }
        actionDisabled={unavailable || !integration.canManage}
        actionLabel={actionLabel}
        description={providerDescriptions[provider.provider]}
        provider={provider}
        unavailableReason={unavailableReason}
        onAction={() => openProvider(provider)}
      />
    )
  }

  return (
    <section className="max-w-[760px] pb-8" aria-labelledby="contacts-im-platform-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="contacts-im-platform-title" className="title-xl-semi-bold text-text-primary">
            {t(($) => $['imPlatform.title'])}
          </h2>
          <p className="mt-1 max-w-2xl system-sm-regular text-text-tertiary">
            {t(($) => $['imPlatform.description'])}{' '}
            <a
              className="text-text-accent underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              href="https://docs.dify.ai/"
              rel="noreferrer"
              target="_blank"
            >
              {t(($) => $['imPlatform.learnMore'])}
            </a>
          </p>
        </div>
        <div
          aria-live="polite"
          className="flex shrink-0 items-center gap-2 rounded-full border border-divider-subtle bg-background-default-subtle px-2.5 py-1 system-xs-medium text-text-secondary"
        >
          <StatusDot status={statusTones[integration.status]} size="small" />
          <span>{currentStatusLabel}</span>
        </div>
      </div>

      {!integration.canManage && (
        <div className="mt-5 rounded-xl border border-divider-subtle bg-background-default-subtle p-4">
          <div className="system-sm-semibold text-text-primary">
            {t(($) => $['imPlatform.permission.title'])}
          </div>
          <div className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['imPlatform.permission.description'])}
          </div>
        </div>
      )}

      <div className="mt-6">
        <div className="mb-2 px-3 system-xs-medium-uppercase text-text-tertiary">
          {integration.provider
            ? t(($) => $['imPlatform.connectMore'])
            : t(($) => $['imPlatform.chooseProvider'])}
        </div>
        <div className="divide-y divide-divider-subtle rounded-xl border border-divider-subtle bg-components-panel-bg">
          {activeProvider && renderProviderCard(activeProvider, 'configure')}
          {providers
            .filter((provider) => provider.provider !== integration.provider)
            .map((provider) =>
              renderProviderCard(provider, integration.provider ? 'replace' : 'connect'),
            )}
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-divider-subtle bg-background-default-subtle p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="system-sm-semibold text-text-primary">
              {t(($) => $['imPlatform.diagnostics.title'])}
            </div>
            <div className="mt-1 system-sm-regular text-text-tertiary">{diagnosticsText}</div>
            <div className="mt-2 system-xs-regular text-text-tertiary">
              {integration.lastCheckedAt
                ? t(($) => $['imPlatform.lastChecked'], {
                    date: formatDate(integration.lastCheckedAt),
                  })
                : t(($) => $['imPlatform.notChecked'])}
            </div>
          </div>
          {integration.provider && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                disabled={!integration.canManage || testConnection.isPending}
                loading={testConnection.isPending}
                onClick={() => testConnection.mutate()}
              >
                {testConnection.isPending
                  ? t(($) => $['imPlatform.action.testing'])
                  : t(($) => $['imPlatform.action.testConnection'])}
              </Button>
              <Button
                tone="destructive"
                disabled={!integration.canManage}
                onClick={() => setDisconnectOpen(true)}
              >
                {t(($) => $['imPlatform.action.disconnect'])}
              </Button>
            </div>
          )}
        </div>
        {testConnection.isError && (
          <div role="alert" className="mt-3 system-xs-regular text-text-destructive">
            {t(($) => $['imPlatform.bindingDialog.testFailed'])}
          </div>
        )}
      </div>

      <ContactImDirectorySyncSection
        formatDate={formatDate}
        integration={integration}
        onViewDetails={setSyncRunId}
      />

      {bindingTarget && (
        <ContactImBindingDialog
          key={`${bindingTarget.provider.provider}-${bindingTarget.replaceActiveProvider}`}
          integration={integration}
          open
          provider={bindingTarget.provider}
          replaceActiveProvider={bindingTarget.replaceActiveProvider}
          onOpenChange={(open) => {
            if (!open) setBindingTarget(null)
          }}
        />
      )}

      {syncRunId && (
        <ContactImSyncDetailsDialog
          open
          runId={syncRunId}
          onOpenChange={(open) => {
            if (!open) setSyncRunId(null)
          }}
        />
      )}

      <AlertDialog
        open={Boolean(replacementProvider)}
        onOpenChange={(open) => {
          if (!open) setReplacementProvider(null)
        }}
      >
        <AlertDialogContent>
          <div className="px-6 pt-6 pb-3">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['imPlatform.replacement.title'], {
                current: activeProvider?.displayName ?? '',
                next: replacementProvider?.displayName ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 system-sm-regular text-text-tertiary">
              {t(($) => $['imPlatform.replacement.description'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="default"
              onClick={() => {
                if (!replacementProvider) return
                setBindingTarget({
                  provider: replacementProvider,
                  replaceActiveProvider: true,
                })
                setReplacementProvider(null)
              }}
            >
              {t(($) => $['imPlatform.replacement.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={disconnectOpen}
        onOpenChange={(open) => {
          if (!disconnectProvider.isPending) setDisconnectOpen(open)
        }}
      >
        <AlertDialogContent>
          <div className="px-6 pt-6 pb-3">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['imPlatform.disconnect.title'], {
                provider: activeProvider?.displayName ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 system-sm-regular text-text-tertiary">
              {t(($) => $['imPlatform.disconnect.description'])}
            </AlertDialogDescription>
            {disconnectProvider.isError && (
              <div role="alert" className="mt-3 system-xs-regular text-text-destructive">
                {t(($) => $['imPlatform.disconnect.failed'])}
              </div>
            )}
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={disconnectProvider.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={disconnectProvider.isPending}
              onClick={() => {
                disconnectProvider.mutate(undefined, {
                  onSuccess: () => setDisconnectOpen(false),
                })
              }}
            >
              {t(($) => $['imPlatform.disconnect.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
