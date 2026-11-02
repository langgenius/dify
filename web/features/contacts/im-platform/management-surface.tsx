'use client'

import type { ChannelSummary } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ContactImProviderDefinition } from './types'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { skipToken, useIsMutating, useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { ContactImBindingContent } from './binding-dialog'
import { useContactsImPlatformOrganization } from './composition-context'
import { providerMetadata, toDetailView } from './credentials'
import { ContactEmailConfigContent } from './email-config-dialog'
import { channelError } from './hooks'
import { ContactImProviderCard } from './provider-card'
import { ContactImSyncDetailsDialog } from './sync-details-dialog'
import { useContactImSyncRunUrlState } from './sync-run-url-state'
import { ContactImDirectorySyncSection } from './sync-section'
import { ContactImRepositoryErrorCode } from './types'

type BindingTarget = {
  integration: ChannelSummary | null
  provider: ContactImProviderDefinition
  replaceActiveProvider: boolean
  replacedIntegration?: ChannelSummary
}

function ConfigurationSession({
  target,
  onOpenChange,
}: {
  target: BindingTarget
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(['contacts'])
  const channels = consoleQuery.workspaces.current.humanInput.v2.channels
  const email = useQuery(
    channels.email.byChannelId.get.queryOptions({
      input:
        target.integration?.kind === 'email'
          ? { params: { channel_id: target.integration.id } }
          : skipToken,
      context: { silent: true },
    }),
  )
  const im = useQuery(
    channels.im.byChannelId.get.queryOptions({
      input:
        target.integration?.kind === 'im'
          ? { params: { channel_id: target.integration.id } }
          : skipToken,
      context: { silent: true },
    }),
  )
  const detail = target.integration?.kind === 'email' ? email : im
  if (target.integration && !detail.data)
    return (
      <>
        <DialogHeader>
          <DialogTitle>{target.provider.displayName}</DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['action.close'])} />
        </DialogHeader>
        {detail.isError ? (
          <div role="alert" className="p-6">
            <p>{t(($) => $['imPlatform.loadError.description'])}</p>
            <Button onClick={() => detail.refetch()}>
              {t(($) => $['imPlatform.action.retry'])}
            </Button>
          </div>
        ) : (
          <div
            aria-busy="true"
            className="m-6 h-40 animate-pulse rounded-xl bg-state-base-active"
          />
        )}
      </>
    )
  const integration = detail.data ? toDetailView(detail.data) : null
  return target.provider.provider === 'resend' ? (
    <ContactEmailConfigContent
      integration={integration}
      provider={target.provider}
      onOpenChange={onOpenChange}
    />
  ) : (
    <ContactImBindingContent
      integration={integration}
      provider={target.provider}
      replaceActiveProvider={target.replaceActiveProvider}
      replacedIntegration={target.replacedIntegration}
      onOpenChange={onOpenChange}
    />
  )
}

export function ContactsImPlatformManagementSurface() {
  const { t } = useTranslation(['contacts'])
  const { t: tCommon } = useTranslation(['common'])
  const organization = useContactsImPlatformOrganization()
  const api = consoleQuery.workspaces.current.humanInput.v2
  const integrationsQuery = useQuery(
    api.channels.get.queryOptions({ enabled: organization.canManage, context: { silent: true } }),
  )
  const providersQuery = useQuery(
    api.channelProviders.get.queryOptions({
      enabled: organization.canManage,
      context: { silent: true },
    }),
  )
  const deleteEmail = useMutation(
    api.channels.email.byChannelId.delete.mutationOptions({ context: { silent: true } }),
  )
  const deleteIM = useMutation(
    api.channels.im.byChannelId.delete.mutationOptions({ context: { silent: true } }),
  )
  const pendingCredentials = useIsMutating({ mutationKey: api.channels.key() }) > 0
  const [bindingTarget, setBindingTarget] = useState<BindingTarget | null>(null)
  const [bindingOpen, setBindingOpen] = useState(false)
  const [replacementProvider, setReplacementProvider] =
    useState<ContactImProviderDefinition | null>(null)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ChannelSummary | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [syncRunId, setSyncRunId] = useContactImSyncRunUrlState()
  const integrations = integrationsQuery.data?.channels ?? []
  const providers = [
    ...(providersQuery.data?.email_providers ?? []),
    ...(providersQuery.data?.im_providers ?? []),
  ].map(({ provider }) => ({
    provider,
    displayName: providerMetadata[provider].name,
    requiredFields: providerMetadata[provider].fields,
  }))
  const byProvider = new Map(integrations.map((integration) => [integration.provider, integration]))
  const configured = providers.filter((provider) => byProvider.has(provider.provider))
  const available = providers.filter((provider) => !byProvider.has(provider.provider))
  const activeIM = integrations.find((integration) => integration.kind === 'im')
  const deleteMutation = deleteTarget?.kind === 'email' ? deleteEmail : deleteIM
  const openBinding = (target: BindingTarget) => {
    setBindingTarget(target)
    setBindingOpen(true)
  }
  const openProvider = (provider: ContactImProviderDefinition) => {
    const integration = byProvider.get(provider.provider) ?? null
    if (provider.provider !== 'resend' && !integration && activeIM) {
      setReplacementProvider(provider)
      setReplacementOpen(true)
      return
    }
    openBinding({ integration, provider, replaceActiveProvider: false })
  }
  const descriptions = {
    ding_talk: t(($) => $['imPlatform.provider.dingtalkDescription']),
    resend: t(($) => $['imPlatform.provider.emailDescription']),
    feishu: t(($) => $['imPlatform.provider.feishuDescription']),
    slack: t(($) => $['imPlatform.provider.slackDescription']),
    lark: t(($) => $['imPlatform.provider.larkDescription']),
    ms_teams: t(($) => $['imPlatform.provider.msTeamsDescription']),
    we_com: t(($) => $['imPlatform.provider.weComDescription']),
  }
  const statuses = {
    connected: t(($) => $['imPlatform.status.connected']),
    configured: t(($) => $['imPlatform.status.configured']),
    connection_failure: t(($) => $['imPlatform.status.connection_error']),
    invalid_credentials: t(($) => $['imPlatform.status.permission_issue']),
  }
  const cards = available.map((provider) => (
    <ContactImProviderCard
      key={provider.provider}
      actionAriaLabel={`${provider.displayName} — ${provider.provider !== 'resend' && activeIM ? t(($) => $['imPlatform.action.replace']) : t(($) => $['imPlatform.action.connect'])}`}
      actionDisabled={!organization.canManage}
      actionLabel={
        provider.provider !== 'resend' && activeIM
          ? t(($) => $['imPlatform.action.replace'])
          : t(($) => $['imPlatform.action.connect'])
      }
      description={descriptions[provider.provider]}
      mode="available"
      provider={provider}
      showAddIcon={provider.provider === 'resend' || !activeIM}
      onAction={() => openProvider(provider)}
    />
  ))
  if (!organization.canManage) return null
  if (integrationsQuery.isPending || providersQuery.isPending)
    return (
      <div aria-busy="true" className="max-w-190 space-y-3 pt-4">
        <div className="h-4 w-52 animate-pulse rounded-md bg-state-base-active" />
        <div className="h-16 animate-pulse rounded-xl bg-state-base-active" />
        <div className="h-16 animate-pulse rounded-xl bg-state-base-active" />
      </div>
    )
  if (integrationsQuery.isError || providersQuery.isError)
    return (
      <div
        role="alert"
        className="max-w-190 rounded-xl border border-divider-subtle bg-background-default-subtle p-5"
      >
        <div className="system-md-semibold">{t(($) => $['imPlatform.loadError.title'])}</div>
        <p>{t(($) => $['imPlatform.loadError.description'])}</p>
        <Button
          onClick={() => {
            void integrationsQuery.refetch()
            void providersQuery.refetch()
          }}
        >
          {t(($) => $['imPlatform.loadError.retry'])}
        </Button>
      </div>
    )
  return (
    <div className="max-w-190 pb-8">
      <div className="space-y-2">
        {configured.map((provider) => {
          const integration = byProvider.get(provider.provider)
          if (!integration) return null
          return (
            <ContactImProviderCard
              key={provider.provider}
              actionDisabled={!organization.canManage}
              configureAriaLabel={t(($) => $['imPlatform.action.configureChannel'], {
                provider: provider.displayName,
              })}
              deleteAriaLabel={t(($) => $['imPlatform.action.deleteChannel'], {
                provider: provider.displayName,
              })}
              description={[
                integration.display_identifier,
                statuses[integration.status],
                integration.status === 'connection_failure' ||
                integration.status === 'invalid_credentials'
                  ? integration.status_description
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              mode="configured"
              provider={provider}
              onConfigure={() => openProvider(provider)}
              onDelete={() => {
                deleteEmail.reset()
                deleteIM.reset()
                setDeleteTarget(integration)
                setDeleteOpen(true)
              }}
            />
          )
        })}
      </div>
      {activeIM && (
        <ContactImDirectorySyncSection integration={activeIM} onViewDetails={setSyncRunId} />
      )}
      {available.length > 0 &&
        (configured.length > 0 ? (
          <Collapsible defaultOpen className="mt-4 border-t border-divider-subtle pt-4">
            <CollapsibleTrigger className="group/collapsible mb-2 flex min-h-4 items-center gap-1 rounded-sm text-start system-sm-medium-uppercase text-text-tertiary">
              <span
                aria-hidden
                className="i-ri-arrow-down-s-line size-4 shrink-0 -rotate-90 group-data-panel-open/collapsible:rotate-0"
              />
              {t(($) => $['imPlatform.connectMore'])}
            </CollapsibleTrigger>
            <CollapsiblePanel className="space-y-2">{cards}</CollapsiblePanel>
          </Collapsible>
        ) : (
          <div className="space-y-2 pt-2">
            <h4 className="system-sm-medium-uppercase text-text-tertiary">
              {t(($) => $['imPlatform.chooseProvider'])}
            </h4>
            {cards}
          </div>
        ))}
      <Dialog
        open={bindingOpen}
        disablePointerDismissal={pendingCredentials}
        onOpenChange={(open) => {
          if (!pendingCredentials) setBindingOpen(open)
        }}
        onOpenChangeComplete={(open) => {
          if (!open) setBindingTarget(null)
        }}
      >
        <DialogContent
          backdropProps={{ forceRender: true }}
          className={bindingTarget?.provider.provider === 'resend' ? 'w-130' : 'w-120'}
        >
          {bindingTarget && (
            <ConfigurationSession
              key={`${bindingTarget.provider.provider}:${bindingTarget.integration?.id ?? 'new'}`}
              target={bindingTarget}
              onOpenChange={setBindingOpen}
            />
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={replacementOpen}
        onOpenChange={setReplacementOpen}
        onOpenChangeComplete={(open) => {
          if (!open) setReplacementProvider(null)
        }}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['imPlatform.replacement.title'], {
                current: activeIM ? providerMetadata[activeIM.provider].name : '',
                next: replacementProvider?.displayName ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['imPlatform.replacement.description'])}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="default"
              onClick={() => {
                if (!replacementProvider) return
                openBinding({
                  integration: null,
                  provider: replacementProvider,
                  replaceActiveProvider: true,
                  replacedIntegration: activeIM,
                })
                setReplacementOpen(false)
              }}
            >
              {t(($) => $['imPlatform.replacement.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleteMutation.isPending) setDeleteOpen(open)
        }}
        onOpenChangeComplete={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['imPlatform.delete.title'], {
                provider: deleteTarget ? providerMetadata[deleteTarget.provider].name : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['imPlatform.delete.description'])}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.isError && (
            <AlertDialogBody>
              <div role="alert" className="text-text-destructive">
                {channelError(deleteMutation.error).code ===
                ContactImRepositoryErrorCode.ConfigurationUpdated
                  ? t(($) => $['imPlatform.configurationUpdated'])
                  : t(($) => $['imPlatform.delete.failed'])}
              </div>
            </AlertDialogBody>
          )}
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={deleteMutation.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={deleteMutation.isPending}
              onClick={() => {
                if (!deleteTarget) return
                deleteMutation.mutate(
                  {
                    params: { channel_id: deleteTarget.id },
                    query: { expected_config_version: deleteTarget.config_version },
                  },
                  { onSuccess: () => setDeleteOpen(false) },
                )
              }}
            >
              {t(($) => $['imPlatform.delete.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ContactImSyncDetailsDialog
        open={Boolean(syncRunId)}
        runId={syncRunId}
        onOpenChange={(open) => {
          if (!open) void setSyncRunId(null)
        }}
      />
    </div>
  )
}
