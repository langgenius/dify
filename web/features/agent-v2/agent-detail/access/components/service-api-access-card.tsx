'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { AccessSurfaceCard } from './access-surface-card'
import { AgentApiKeyModal } from './agent-api-key-modal'

export function ServiceApiAccessCard({ agentId }: { agentId: string }) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const docLink = useDocLink()
  const queryClient = useQueryClient()
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false)
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
  const accessReady = Boolean(apiAccess?.access_ready)
  const pendingEnabled = toggleServiceApiMutation.variables?.body.enable_api
  const optimisticEnabled =
    toggleServiceApiMutation.isPending && pendingEnabled !== undefined
      ? pendingEnabled
      : Boolean(apiAccess?.enabled)
  const showPublishRequiredMessage =
    !apiAccessQuery.isPending && !apiAccessQuery.isError && !accessReady

  function handleEnabledChange(enabled: boolean) {
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
    <>
      <AccessSurfaceCard
        title={t(($) => $['agentDetail.access.serviceApi.title'])}
        icon="i-ri-node-tree"
        iconClassName="bg-state-accent-solid text-text-primary-on-surface"
        endpointLabel={t(($) => $['agentDetail.access.serviceApi.endpoint'])}
        endpoint={apiAccess?.service_api_base_url ?? ''}
        enabled={optimisticEnabled}
        onEnabledChange={handleEnabledChange}
        copyLabel={t(($) => $['agentDetail.access.copyServiceEndpoint'])}
        disabled={apiAccessQuery.isPending || apiAccessQuery.isError || !accessReady}
        disabledReason={
          showPublishRequiredMessage ? t(($) => $['agentDetail.access.publishRequired']) : undefined
        }
      >
        <Button
          variant="secondary"
          size="medium"
          disabled={apiAccessQuery.isPending || apiAccessQuery.isError || !accessReady}
          onClick={() => setApiKeyModalOpen(true)}
        >
          <span aria-hidden className="i-ri-key-2-line size-4" />
          {t(($) => $['agentDetail.access.serviceApi.actions.apiKey'])}
          <span className="rounded-md bg-components-badge-bg-gray-soft px-1.5 code-xs-regular text-text-tertiary">
            {apiAccess?.api_key_count ?? 0}
          </span>
        </Button>
        <a
          href={docLink('/api-reference/guides/agent')}
          target="_blank"
          rel="noreferrer"
          aria-label={t(($) => $['agentDetail.access.serviceApi.actions.apiReference'])}
          className={buttonVariants({ variant: 'secondary', size: 'medium' })}
        >
          <span aria-hidden className="i-ri-book-open-line size-4" />
          {t(($) => $['agentDetail.access.serviceApi.actions.apiReference'])}
        </a>
        {apiAccessQuery.isError && (
          <Button
            variant="secondary"
            size="medium"
            onClick={() => {
              void apiAccessQuery.refetch()
            }}
          >
            <span aria-hidden className="i-ri-refresh-line size-4" />
            {tCommon(($) => $['operation.retry'])}
          </Button>
        )}
      </AccessSurfaceCard>

      <AgentApiKeyModal
        agentId={agentId}
        open={apiKeyModalOpen}
        onOpenChange={setApiKeyModalOpen}
      />
    </>
  )
}
