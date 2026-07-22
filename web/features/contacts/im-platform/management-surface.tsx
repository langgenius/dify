'use client'

import type { ContactImIntegrationView, ContactImProviderDefinition } from './types'
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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContactImBindingDialog } from './binding-dialog'
import { useContactsImPlatformOrganization } from './composition-context'
import { ContactEmailConfigDialog } from './email-config-dialog'
import {
  useContactImIntegrations,
  useContactImProviderDefinitions,
  useDisconnectContactImProvider,
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

type BindingTarget = {
  integration: ContactImIntegrationView | null
  provider: ContactImProviderDefinition
}

export function ContactsImPlatformManagementSurface() {
  const { t, i18n } = useTranslation('contacts')
  const { t: tCommon } = useTranslation('common')
  const organization = useContactsImPlatformOrganization()
  const integrationsQuery = useContactImIntegrations()
  const providersQuery = useContactImProviderDefinitions()
  const disconnectProvider = useDisconnectContactImProvider()
  const [bindingTarget, setBindingTarget] = useState<BindingTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ContactImProviderDefinition | null>(null)
  const [syncRunId, setSyncRunId] = useContactImSyncRunUrlState()

  if (integrationsQuery.isPending || providersQuery.isPending) {
    return (
      <div
        role="status"
        aria-label={t(($) => $['imPlatform.loading'])}
        className="max-w-[760px] space-y-3"
      >
        <div className="h-4 w-52 animate-pulse rounded-md bg-state-base-active motion-reduce:animate-none" />
        <div className="h-16 w-full animate-pulse rounded-xl bg-state-base-active motion-reduce:animate-none" />
        <div className="h-16 w-full animate-pulse rounded-xl bg-state-base-active motion-reduce:animate-none" />
      </div>
    )
  }

  if (integrationsQuery.isError || providersQuery.isError) {
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
            void integrationsQuery.refetch()
            void providersQuery.refetch()
          }}
        >
          {t(($) => $['imPlatform.loadError.retry'])}
        </Button>
      </div>
    )
  }

  const integrations = integrationsQuery.data
  const providers = providersQuery.data
  const integrationsByProvider = new Map(
    integrations.map((integration) => [integration.provider, integration]),
  )
  const configuredProviders = providers.filter((provider) =>
    integrationsByProvider.has(provider.provider),
  )
  const availableProviders = providers.filter(
    (provider) => !integrationsByProvider.has(provider.provider),
  )
  const syncIntegration =
    integrations.find(
      (integration) =>
        integration.status === ContactImConnectionStatus.Connected &&
        integration.capabilities.directorySync,
    ) ??
    integrations.find((integration) => integration.capabilities.directorySync) ??
    integrations.find((integration) => integration.provider !== ContactImProvider.Email)
  const providerDescriptions = {
    [ContactImProvider.DingTalk]: t(($) => $['imPlatform.provider.dingtalkDescription']),
    [ContactImProvider.Email]: t(($) => $['imPlatform.provider.emailDescription']),
    [ContactImProvider.Feishu]: t(($) => $['imPlatform.provider.feishuDescription']),
    [ContactImProvider.Slack]: t(($) => $['imPlatform.provider.slackDescription']),
  }
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
  const unavailableReasonLabels = {
    [ContactImUnavailableReason.DeploymentUnsupported]: t(
      ($) => $['imPlatform.provider.unavailableReason.deployment_unsupported'],
    ),
    [ContactImUnavailableReason.NotReleased]: t(
      ($) => $['imPlatform.provider.unavailableReason.not_released'],
    ),
  }
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))

  const openProvider = (provider: ContactImProviderDefinition) => {
    if (
      provider.availability !== ContactImProviderAvailability.Available ||
      !organization.canManage
    ) {
      return
    }

    setBindingTarget({
      integration: integrationsByProvider.get(provider.provider) ?? null,
      provider,
    })
  }

  const openDeleteDialog = (provider: ContactImProviderDefinition) => {
    if (!organization.canManage) return

    disconnectProvider.reset()
    setDeleteTarget(provider)
  }

  const handleDeleteDialogOpenChange = (open: boolean) => {
    if (open || disconnectProvider.isPending) return

    setDeleteTarget(null)
  }

  const deleteChannel = () => {
    if (!deleteTarget || disconnectProvider.isPending) return

    disconnectProvider.mutate(
      { provider: deleteTarget.provider },
      { onSuccess: () => setDeleteTarget(null) },
    )
  }

  const getConfiguredDescription = (
    provider: ContactImProviderDefinition,
    integration: ContactImIntegrationView,
  ) => {
    if (integration.statusReason) return statusReasonLabels[integration.statusReason]
    if (provider.provider === ContactImProvider.Email && integration.displayIdentifier)
      return t(($) => $['imPlatform.email.summary'], { email: integration.displayIdentifier })
    return integration.displayIdentifier ?? statusLabels[integration.status]
  }

  return (
    <section className="max-w-[760px] pb-8" aria-labelledby="contacts-channels-title">
      <h2 id="contacts-channels-title" className="sr-only">
        {t(($) => $['imPlatform.title'])}
      </h2>

      {!organization.canManage && (
        <div className="mb-4 rounded-xl border border-divider-subtle bg-background-default-subtle p-4">
          <div className="system-sm-semibold text-text-primary">
            {t(($) => $['imPlatform.permission.title'])}
          </div>
          <div className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['imPlatform.permission.description'])}
          </div>
        </div>
      )}

      {configuredProviders.length > 0 && (
        <div className="space-y-2">
          {configuredProviders.map((provider) => {
            const integration = integrationsByProvider.get(provider.provider)
            if (!integration) return null

            return (
              <div key={provider.provider}>
                <span className="sr-only" aria-live="polite">
                  {statusLabels[integration.status]}
                </span>
                <ContactImProviderCard
                  actionDisabled={!organization.canManage}
                  configureAriaLabel={t(($) => $['imPlatform.action.configureChannel'], {
                    provider: provider.displayName,
                  })}
                  deleteAriaLabel={t(($) => $['imPlatform.action.deleteChannel'], {
                    provider: provider.displayName,
                  })}
                  description={getConfiguredDescription(provider, integration)}
                  mode="configured"
                  provider={provider}
                  onConfigure={() => openProvider(provider)}
                  onDelete={() => openDeleteDialog(provider)}
                />
              </div>
            )
          })}
        </div>
      )}

      {syncIntegration && (
        <ContactImDirectorySyncSection
          formatDate={formatDate}
          integration={syncIntegration}
          onViewDetails={setSyncRunId}
        />
      )}

      {availableProviders.length > 0 && (
        <div
          className={
            configuredProviders.length > 0 ? 'mt-4 border-t border-divider-subtle pt-4' : ''
          }
        >
          <div className="mb-2 system-xs-medium-uppercase text-text-tertiary">
            {configuredProviders.length > 0
              ? t(($) => $['imPlatform.connectMore'])
              : t(($) => $['imPlatform.chooseProvider'])}
          </div>
          <div className="space-y-2">
            {availableProviders.map((provider) => {
              const unavailable =
                provider.availability === ContactImProviderAvailability.Unavailable
              return (
                <ContactImProviderCard
                  key={provider.provider}
                  actionAriaLabel={`${provider.displayName} — ${
                    unavailable
                      ? t(($) => $['imPlatform.provider.unavailable'])
                      : t(($) => $['imPlatform.action.connect'])
                  }`}
                  actionDisabled={unavailable || !organization.canManage}
                  actionLabel={
                    unavailable
                      ? t(($) => $['imPlatform.provider.unavailable'])
                      : t(($) => $['imPlatform.action.connect'])
                  }
                  description={providerDescriptions[provider.provider]}
                  mode="available"
                  provider={provider}
                  showAddIcon={!unavailable}
                  unavailableReason={
                    provider.unavailableReason
                      ? unavailableReasonLabels[provider.unavailableReason]
                      : undefined
                  }
                  onAction={() => openProvider(provider)}
                />
              )
            })}
          </div>
        </div>
      )}

      {bindingTarget?.provider.provider === ContactImProvider.Email && (
        <ContactEmailConfigDialog
          integration={bindingTarget.integration}
          open
          provider={bindingTarget.provider}
          onOpenChange={(open) => {
            if (!open) setBindingTarget(null)
          }}
        />
      )}

      {bindingTarget && bindingTarget.provider.provider !== ContactImProvider.Email && (
        <ContactImBindingDialog
          key={bindingTarget.provider.provider}
          integration={bindingTarget.integration}
          open
          provider={bindingTarget.provider}
          onOpenChange={(open) => {
            if (!open) setBindingTarget(null)
          }}
        />
      )}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={handleDeleteDialogOpenChange}>
        <AlertDialogContent>
          <div className="space-y-2 p-6">
            <AlertDialogTitle className="title-md-semi-bold text-text-primary">
              {t(($) => $['imPlatform.delete.title'], {
                provider: deleteTarget?.displayName ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-tertiary">
              {t(($) => $['imPlatform.delete.description'])}
            </AlertDialogDescription>
            {disconnectProvider.isError && (
              <div role="alert" className="system-sm-regular text-text-destructive">
                {t(($) => $['imPlatform.delete.failed'])}
              </div>
            )}
          </div>
          <AlertDialogActions className="pt-0">
            <AlertDialogCancelButton disabled={disconnectProvider.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={disconnectProvider.isPending}
              onClick={deleteChannel}
            >
              {t(($) => $['imPlatform.delete.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>

      {syncRunId && (
        <ContactImSyncDetailsDialog
          open
          runId={syncRunId}
          onOpenChange={(open) => {
            if (!open) setSyncRunId(null)
          }}
        />
      )}
    </section>
  )
}
