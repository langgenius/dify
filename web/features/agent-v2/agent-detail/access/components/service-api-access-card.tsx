'use client'

import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { accessSurfaceActionClassName, AccessSurfaceCard } from './access-surface-card'
import { AgentApiKeyModal } from './agent-api-key-modal'

export function ServiceApiAccessCard({
  agentId,
}: {
  agentId: string
}) {
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
  const toggleServiceApiMutation = useMutation(consoleQuery.agent.byAgentId.apiEnable.post.mutationOptions({
    onSuccess: (updatedApiAccess, variables) => {
      queryClient.setQueryData(apiAccessQueryOptions.queryKey, updatedApiAccess)
      queryClient.setQueryData<AgentAppDetailWithSite | undefined>(
        consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: agentId } } }),
        agentDetail => agentDetail
          ? {
              ...agentDetail,
              enable_api: variables.body.enable_api,
            }
          : agentDetail,
      )
      toast.success(tCommon('actionMsg.modifiedSuccessfully'))
    },
    onError: () => {
      toast.error(tCommon('actionMsg.modifiedUnsuccessfully'))
    },
  }))
  const isBusy = apiAccessQuery.isPending || toggleServiceApiMutation.isPending

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
        title={t('agentDetail.access.serviceApi.title')}
        icon="i-ri-node-tree"
        iconClassName="bg-state-accent-solid text-text-primary-on-surface"
        endpointLabel={t('agentDetail.access.serviceApi.endpoint')}
        endpoint={apiAccess?.service_api_base_url ?? ''}
        enabled={Boolean(apiAccess?.enabled)}
        onEnabledChange={handleEnabledChange}
        copyLabel={t('agentDetail.access.copyServiceEndpoint')}
        disabled={apiAccessQuery.isPending || apiAccessQuery.isError}
        busy={toggleServiceApiMutation.isPending}
      >
        <Button
          variant="secondary"
          size="medium"
          className="gap-1.5 px-3"
          disabled={isBusy || apiAccessQuery.isError}
          onClick={() => setApiKeyModalOpen(true)}
        >
          <span aria-hidden className="i-ri-key-2-line size-4" />
          {t('agentDetail.access.serviceApi.actions.apiKey')}
          <span className="rounded-md bg-components-badge-bg-gray-soft px-1.5 code-xs-regular text-text-tertiary">
            {apiAccess?.api_key_count ?? 0}
          </span>
        </Button>
        <a
          href={docLink('/use-dify/publish/developing-with-apis')}
          target="_blank"
          rel="noreferrer"
          aria-label={t('agentDetail.access.serviceApi.actions.apiReference')}
          className={accessSurfaceActionClassName}
        >
          <span aria-hidden className="i-ri-book-open-line size-4" />
          {t('agentDetail.access.serviceApi.actions.apiReference')}
        </a>
        {apiAccessQuery.isError && (
          <Button
            variant="secondary"
            size="medium"
            className="gap-1.5 px-3"
            onClick={() => {
              void apiAccessQuery.refetch()
            }}
          >
            <span aria-hidden className="i-ri-refresh-line size-4" />
            {tCommon('operation.retry')}
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
