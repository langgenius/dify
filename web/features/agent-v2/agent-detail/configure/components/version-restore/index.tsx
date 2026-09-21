'use client'

import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import { toast } from '@/app/notifications'
import { useAgentPermissions } from '@/features/agent-v2/permissions'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'

type RestoreActions = {
  requestRestore: (version: AgentConfigSnapshotSummaryResponse) => void
  canRestore: boolean
  disabled: boolean
  isPending: boolean
}

export function AgentVersionRestore({
  agentId,
  onBeforeRestore,
  disabled: externallyDisabled = false,
  onRestored,
  children,
}: {
  children: (actions: RestoreActions) => ReactNode
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
  const [stage, setStage] = useState<'closed' | 'upgrade' | 'confirm'>('closed')
  const [version, setVersion] = useState<AgentConfigSnapshotSummaryResponse | null>(null)
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
        setStage('closed')
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
      setStage('upgrade')
      return
    }
    setVersion(selectedVersion)
    setStage('confirm')
  }

  const confirmRestore = () => {
    if (!version || disabled || mutation.isPending) return
    if (showUpgrade) {
      setStage('upgrade')
      return
    }
    mutation.mutate({ params: { agent_id: agentId, version_id: version.id } })
  }

  const versionLabel = version
    ? version.version_note ||
      t(($) => $['agentDetail.versionHistory.versionName'], { version: version.version })
    : ''

  return (
    <>
      {children({
        requestRestore,
        isPending: mutation.isPending,
        disabled: disabled || mutation.isPending,
        canRestore,
      })}
      <PlanUpgradeModal
        show={stage === 'upgrade'}
        onClose={() => setStage('closed')}
        title={t(($) => $['upgrade.agentRestore.title'], { ns: 'billing' })}
        description={t(($) => $['upgrade.agentRestore.description'], { ns: 'billing' })}
      />
      <AlertDialog
        open={stage === 'confirm'}
        onOpenChange={(open) => {
          if (!mutation.isPending) setStage(open ? 'confirm' : 'closed')
        }}
      >
        <AlertDialogContent>
          <div className="flex flex-col gap-2 p-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {`${t(($) => $['agentDetail.versionHistory.restore'])} ${versionLabel}`}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-md-regular text-text-secondary">
              {t(($) => $['versionHistory.restorationTip'], { ns: 'workflow' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary" disabled={mutation.isPending}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="default"
              disabled={disabled || mutation.isPending}
              loading={mutation.isPending}
              onClick={confirmRestore}
            >
              {t(($) => $['agentDetail.versionHistory.restore'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
