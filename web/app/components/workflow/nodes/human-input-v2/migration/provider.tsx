import type { PropsWithChildren } from 'react'
import type { HumanInputMigrationBlocker } from './types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodes, useStoreApi } from 'reactflow'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useNodesMetaData } from '@/app/components/workflow/hooks/use-nodes-meta-data'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import {
  useWorkflowHistory,
  WorkflowHistoryEvent,
} from '@/app/components/workflow/hooks/use-workflow-history'
import { BlockEnum } from '@/app/components/workflow/types'
import { ENABLE_HITL_IM } from '@/config'
import { syncHumanInputDraft } from '../../human-input/shared/sync-draft'
import { HumanInputMigrationContext } from './context'
import { createHumanInputMigrationApi, executeHumanInputV2Migration } from './executor'
import HumanInputMigrationBanner from './migration-banner'
import HumanInputMigrationDialog from './migration-dialog'
import { getHumanInputCreationPolicy, isLegacyHumanInputNodeData } from './policy'
import { HumanInputMigrationBlockerCode } from './types'

type HumanInputMigrationProviderProps = PropsWithChildren<{
  canEdit: boolean
}>

const getBlockerTranslationKey = (
  code: Exclude<
    HumanInputMigrationBlocker['code'],
    typeof HumanInputMigrationBlockerCode.UnsupportedInputType
  >,
) => {
  switch (code) {
    case HumanInputMigrationBlockerCode.UnsupportedVersion:
      return 'nodes.humanInputMigration.blocker.unsupportedVersion' as const
    case HumanInputMigrationBlockerCode.ConfiguredDisabledMethod:
      return 'nodes.humanInputMigration.blocker.configuredDisabledMethod' as const
    case HumanInputMigrationBlockerCode.UnsupportedDeliveryMethod:
      return 'nodes.humanInputMigration.blocker.unsupportedDeliveryMethod' as const
    case HumanInputMigrationBlockerCode.InvalidEmailConfiguration:
      return 'nodes.humanInputMigration.blocker.invalidEmailConfiguration' as const
    case HumanInputMigrationBlockerCode.InvalidDefaultValue:
      return 'nodes.humanInputMigration.blocker.invalidDefaultValue' as const
    case HumanInputMigrationBlockerCode.InvalidEmail:
      return 'nodes.humanInputMigration.blocker.invalidEmail' as const
    case HumanInputMigrationBlockerCode.UnresolvedMember:
      return 'nodes.humanInputMigration.blocker.unresolvedMember' as const
    case HumanInputMigrationBlockerCode.ConflictingEmailTemplates:
      return 'nodes.humanInputMigration.blocker.conflictingEmailTemplates' as const
    case HumanInputMigrationBlockerCode.MissingRecipients:
      return 'nodes.humanInputMigration.blocker.missingRecipients' as const
  }
}

const ActiveHumanInputMigrationProvider = ({
  children,
  canEdit,
}: HumanInputMigrationProviderProps) => {
  const { t } = useTranslation(['workflow'])
  const nodes = useNodes() as Node[]
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()
  const { nodesMap } = useNodesMetaData()
  const [dialogOpen, setDialogOpen] = useState(false)
  const canApplyRef = useRef(canEdit)
  useEffect(() => {
    canApplyRef.current = canEdit
    return () => {
      canApplyRef.current = false
    }
  }, [canEdit])
  const policy = useMemo(() => getHumanInputCreationPolicy(nodes, canEdit), [canEdit, nodes])
  const legacyNodeCount = useMemo(
    () => nodes.filter((node) => isLegacyHumanInputNodeData(node.data)).length,
    [nodes],
  )
  const helpLink = nodesMap?.[BlockEnum.HumanInputV2]?.metaData.helpLinkUri

  const migrationApi = useMemo(() => createHumanInputMigrationApi(), [])

  const replaceGraph = useCallback(
    (graph: { nodes: Node[]; edges: Edge[] }, source: string) => {
      collaborativeWorkflow.setNodes(graph.nodes, true, source)
    },
    [collaborativeWorkflow],
  )

  const migration = useMutation({
    mutationFn: () =>
      executeHumanInputV2Migration({
        getGraph: () => {
          const state = store.getState()
          return { nodes: state.getNodes() as Node[], edges: state.edges as Edge[] }
        },
        canApply: () => canApplyRef.current,
        migrationApi,
        replaceGraph,
        syncDraft: () => syncHumanInputDraft(doSyncWorkflowDraft),
        saveHistory: (migratedNodeIds) =>
          saveStateToHistory(WorkflowHistoryEvent.HumanInputMigration, {
            nodeId: migratedNodeIds[0],
          }),
      }),
    onSuccess: (result) => {
      if (result.status === 'success' || result.status === 'noop') setDialogOpen(false)
    },
  })
  const { reset, mutate, isPending: pending } = migration
  const openMigrationDialog = useCallback(() => {
    if (!canEdit || !policy.hasLegacyHumanInput) return
    reset()
    setDialogOpen(true)
  }, [canEdit, policy.hasLegacyHumanInput, reset])
  const handleDialogOpenChange = (open: boolean) => {
    if (pending) return
    setDialogOpen(open)
    if (!open) reset()
  }
  const result = migration.data
  const error = migration.isError
    ? t(($) => $['nodes.humanInputMigration.error.preflight'], { ns: 'workflow' })
    : result?.status === 'blocked'
      ? (() => {
          const blocker = result.blockers[0]
          if (!blocker)
            return t(($) => $['nodes.humanInputMigration.error.preflight'], { ns: 'workflow' })
          const reason =
            blocker.code === HumanInputMigrationBlockerCode.UnsupportedInputType
              ? t(($) => $['nodes.humanInputMigration.blocker.unsupportedInputType'], {
                  ns: 'workflow',
                  field: blocker.value,
                })
              : t(($) => $[getBlockerTranslationKey(blocker.code)], { ns: 'workflow' })
          return t(($) => $['nodes.humanInputMigration.error.blocked'], {
            ns: 'workflow',
            nodeTitle: blocker.nodeTitle,
            reason,
          })
        })()
      : result?.status === 'graph-changed'
        ? t(($) => $['nodes.humanInputMigration.error.graphChanged'], { ns: 'workflow' })
        : result?.status === 'sync-error'
          ? t(($) => $['nodes.humanInputMigration.error.sync'], { ns: 'workflow' })
          : undefined

  const contextValue = useMemo(
    () => ({ policy, canEdit, pending, helpLink, openMigrationDialog }),
    [canEdit, helpLink, openMigrationDialog, pending, policy],
  )

  return (
    <HumanInputMigrationContext value={contextValue}>
      {children}
      {policy.hasLegacyHumanInput && (
        <div className="pointer-events-none absolute inset-s-16 inset-e-1 top-1 z-20">
          <HumanInputMigrationBanner
            canEdit={canEdit}
            helpLink={helpLink}
            onMigrate={openMigrationDialog}
          />
        </div>
      )}
      <HumanInputMigrationDialog
        open={dialogOpen && (policy.hasLegacyHumanInput || pending)}
        pending={pending}
        nodeCount={legacyNodeCount}
        error={error}
        onOpenChange={handleDialogOpenChange}
        onConfirm={() => {
          if (canEdit && !pending) mutate()
        }}
      />
    </HumanInputMigrationContext>
  )
}

const HumanInputMigrationProvider = (props: HumanInputMigrationProviderProps) => {
  if (!ENABLE_HITL_IM) return props.children
  return <ActiveHumanInputMigrationProvider {...props} />
}

export default HumanInputMigrationProvider
