'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { AccessPointUrl } from '@/app/components/base/access-point/url'
import { toast } from '@/app/notifications'
import { useDocLink } from '@/context/i18n'
import { useAgentPermissions } from '@/features/agent-v2/permissions'
import { consoleQuery } from '@/service/console'
import { AgentApiKeyDialogContent } from './agent-api-key-dialog-content'

export function ServiceApiAccessCard({ agentId }: { agentId: string }) {
  const { t } = useTranslation(['agentV2'])
  const { t: tCommon } = useTranslation(['common'])
  const docLink = useDocLink()
  const queryClient = useQueryClient()
  const { canManageAccessPoint } = useAgentPermissions(agentId)
  const apiAccessQueryOptions = consoleQuery.agent.byAgentId.apiAccess.get.queryOptions({
    input: {
      params: {
        agent_id: agentId,
      },
    },
  })
  const apiAccessQuery = useQuery(apiAccessQueryOptions)
  const apiAccess = apiAccessQuery.data
  const toggleServiceApiMutation = useMutation(
    consoleQuery.agent.byAgentId.apiEnable.post.mutationOptions({
      scope: {
        id: `agent-service-api-toggle:${agentId}`,
      },
      onSuccess: (updatedApiAccess, variables) => {
        queryClient.setQueryData(apiAccessQueryOptions.queryKey, updatedApiAccess)
        queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
          consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
          (agentDetail) =>
            agentDetail
              ? {
                  ...agentDetail,
                  enable_api: variables.body.enable_api,
                }
              : agentDetail,
        )
      },
      onError: () => {
        toast.error(tCommon(($) => $['actionMsg.modifiedUnsuccessfully']))
      },
    }),
  )
  const createApiKey = useMutation(consoleQuery.agent.byAgentId.apiKeys.post.mutationOptions())
  const deleteApiKey = useMutation(
    consoleQuery.agent.byAgentId.apiKeys.byApiKeyId.delete.mutationOptions(),
  )
  const apiKeyMutationPending = createApiKey.isPending || deleteApiKey.isPending
  const accessReady = Boolean(apiAccess?.access_ready)
  const pendingEnabled = toggleServiceApiMutation.variables?.body.enable_api
  const optimisticEnabled =
    toggleServiceApiMutation.isPending && pendingEnabled !== undefined
      ? pendingEnabled
      : Boolean(apiAccess?.enabled)
  const endpoint = apiAccess?.service_api_base_url ?? ''
  const status = apiAccessQuery.isPending
    ? 'loading'
    : apiAccessQuery.isError
      ? 'unavailable'
      : optimisticEnabled
        ? 'inService'
        : 'disabled'
  const statusLabel = apiAccessQuery.isPending
    ? tCommon(($) => $.loading)
    : apiAccessQuery.isError
      ? t(($) => $['agentDetail.access.status.unavailable'])
      : t(
          ($) =>
            $[
              optimisticEnabled
                ? 'agentDetail.access.status.inService'
                : 'agentDetail.access.status.outOfService'
            ],
        )
  const notAvailableLabel = t(($) => $['agentDetail.access.workflow.notAvailable'])
  const apiKeyActionDisabled =
    !canManageAccessPoint || apiAccessQuery.isPending || apiAccessQuery.isError || !accessReady
  const showPublishRequiredMessage =
    !apiAccessQuery.isPending && !apiAccessQuery.isError && !accessReady

  function handleEnabledChange(enabled: boolean) {
    if (!canManageAccessPoint) return
    toggleServiceApiMutation.mutate({
      params: {
        agent_id: agentId,
      },
      body: {
        enable_api: enabled,
      },
    })
  }

  return (
    <AccessPointCard
      className="min-h-55.5"
      headingLevel={3}
      title={t(($) => $['agentDetail.access.serviceApi.title'])}
      description={t(($) => $['agentDetail.access.serviceApi.description'])}
      icon="i-custom-vender-knowledge-api-aggregate"
      status={status}
      statusLabel={statusLabel}
      switchDisabled={apiKeyActionDisabled}
      switchDisabledReason={
        showPublishRequiredMessage ? t(($) => $['agentDetail.access.publishRequired']) : undefined
      }
      switchLabel={t(($) => $['agentDetail.access.toggleSurface'], {
        name: t(($) => $['agentDetail.access.serviceApi.title']),
      })}
      onEnabledChange={handleEnabledChange}
      actions={
        <>
          <Dialog
            onOpenChange={(open, details) => {
              if (!open && apiKeyMutationPending) details.cancel()
            }}
          >
            <DialogTrigger
              render={
                <Button
                  variant="secondary"
                  disabled={apiKeyActionDisabled}
                  className="flex items-center gap-1 px-3"
                />
              }
            >
              <span aria-hidden className="i-ri-key-2-line size-4" />
              {t(($) => $['agentDetail.access.serviceApi.actions.apiKey'])}
              <span
                className={cn(
                  'flex min-w-4 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase tabular-nums',
                  apiKeyActionDisabled ? 'text-text-disabled' : 'text-text-tertiary',
                )}
              >
                {apiAccess?.api_key_count ?? 0}
              </span>
            </DialogTrigger>
            <AgentApiKeyDialogContent
              agentId={agentId}
              canManage={canManageAccessPoint}
              isCreating={createApiKey.isPending}
              isDeleting={deleteApiKey.isPending}
              createdKey={createApiKey.data?.token}
              onCreate={(onSuccess) => {
                if (!canManageAccessPoint || apiKeyMutationPending) return
                createApiKey.mutate({ params: { agent_id: agentId } }, { onSuccess })
              }}
              onDelete={(keyId, onSuccess) => {
                if (!canManageAccessPoint || apiKeyMutationPending) return
                deleteApiKey.mutate(
                  { params: { agent_id: agentId, api_key_id: keyId } },
                  { onSuccess },
                )
              }}
            />
          </Dialog>
          <a
            href={docLink('/api-reference/guides/agent')}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({
              variant: 'secondary',
              size: 'medium',
              className: 'flex items-center gap-1 px-3',
            })}
          >
            <span aria-hidden className="i-ri-book-open-line size-4" />
            {t(($) => $['agentDetail.access.serviceApi.actions.apiReference'])}
            <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
          </a>
          {apiAccessQuery.isError && (
            <Button
              variant="secondary"
              className="flex items-center gap-1 px-3"
              onClick={() => {
                void apiAccessQuery.refetch()
              }}
            >
              <span aria-hidden className="i-ri-refresh-line size-4" />
              {tCommon(($) => $['operation.retry'])}
            </Button>
          )}
        </>
      }
    >
      <AccessPointUrl
        label={t(($) => $['agentDetail.access.serviceApi.endpoint'])}
        value={endpoint || notAvailableLabel}
        enabled={optimisticEnabled}
        copyDisabled={!endpoint}
        loading={apiAccessQuery.isPending}
        unavailable={apiAccessQuery.isError}
        unavailableLabel={notAvailableLabel}
        copyLabel={t(($) => $['agentDetail.access.copyServiceEndpoint'])}
        copiedLabel={tCommon(($) => $['operation.copied'])}
        onCopyError={() => {
          toast.error(t(($) => $['agentDetail.access.copyFailed']))
        }}
      />
    </AccessPointCard>
  )
}
