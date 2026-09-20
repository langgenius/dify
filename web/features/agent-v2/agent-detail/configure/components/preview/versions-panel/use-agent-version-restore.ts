import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useAgentPermissions } from '@/features/agent-v2/permissions'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'

export function useAgentVersionRestore({
  agentId,
  onBeforeRestore,
  disabled: externallyDisabled = false,
  onRestored,
}: {
  agentId: string
  disabled?: boolean
  onBeforeRestore?: () => void | Promise<void>
  onRestored?: () => void | Promise<void>
}) {
  const { t } = useTranslation('agentV2')
  const queryClient = useQueryClient()
  const { canReleaseAndVersion: canRestore } = useAgentPermissions(agentId)
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false)
  const [version, setVersion] = useState<AgentConfigSnapshotSummaryResponse | null>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const showUpgrade = deploymentEdition === 'CLOUD' && plan === 'sandbox'
  const disabled =
    externallyDisabled || !canRestore || (deploymentEdition === 'CLOUD' && plan === undefined)
  const mutation = useMutation(
    consoleQuery.agent.byAgentId.versions.byVersionId.restore.post.mutationOptions({
      onMutate: async () => {
        await onBeforeRestore?.()
      },
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: consoleQuery.agent.byAgentId.get.queryKey({
              input: { params: { agent_id: agentId } },
            }),
          }),
          queryClient.invalidateQueries({
            queryKey: consoleQuery.agent.byAgentId.composer.get.queryKey({
              input: { params: { agent_id: agentId } },
            }),
          }),
          queryClient.invalidateQueries({
            queryKey: consoleQuery.agent.byAgentId.versions.get.key(),
          }),
        ])
        await onRestored?.()
        setIsConfirmOpen(false)
        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
      },
      onError: () => {
        toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
      },
    }),
  )

  const requestRestore = (selectedVersion: AgentConfigSnapshotSummaryResponse) => {
    if (disabled || mutation.isPending) return
    if (showUpgrade) {
      setIsUpgradeOpen(true)
      return
    }
    setVersion(selectedVersion)
    setIsConfirmOpen(true)
  }

  const confirmRestore = () => {
    if (!version || disabled || mutation.isPending) return
    if (showUpgrade) {
      setIsConfirmOpen(false)
      setIsUpgradeOpen(true)
      return
    }
    mutation.mutate({ params: { agent_id: agentId, version_id: version.id } })
  }

  return {
    requestRestore,
    isPending: mutation.isPending,
    disabled: disabled || mutation.isPending,
    canRestore,
    showUpgrade,
    version,
    isUpgradeOpen,
    closeUpgrade: () => setIsUpgradeOpen(false),
    isConfirmOpen,
    onConfirmOpenChange: (open: boolean) => {
      if (!mutation.isPending) setIsConfirmOpen(open)
    },
    confirmRestore,
  }
}
