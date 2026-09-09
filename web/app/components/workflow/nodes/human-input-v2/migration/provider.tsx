import type { PropsWithChildren } from 'react'
import type { HumanInputMigrationBlocker } from './types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { toast } from '@langgenius/dify-ui/toast'
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
import { HumanInputMigrationContext } from './context'
import { createHumanInputMigrationApi, executeHumanInputV2Migration } from './executor'
import HumanInputMigrationBanner from './migration-banner'
import HumanInputMigrationDialog from './migration-dialog'
import { getHumanInputCreationPolicy, isLegacyHumanInputNodeData } from './policy'
import { HumanInputMigrationBlockerCode } from './types'

type HumanInputMigrationProviderProps = PropsWithChildren<{
  canEdit: boolean
}>

const getBlockerTranslationKey = (code: HumanInputMigrationBlocker['code']) => {
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

const syncDraftOnce = async (
  doSyncWorkflowDraft: ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft'],
) => {
  let saved = false
  let failed = false
  const result = await doSyncWorkflowDraft(true, {
    onSuccess: () => {
      saved = true
    },
    onError: () => {
      failed = true
    },
  })
  // Read-only, unloaded, and non-persisting collaboration paths can settle with
  // no save. Completion alone must not turn an unsaved migration into success.
  if (failed || (!saved && result == null)) throw new Error('human-input-migration-sync-failed')
}

const HumanInputMigrationProvider = ({ children, canEdit }: HumanInputMigrationProviderProps) => {
  const { t } = useTranslation()
  const nodes = useNodes() as Node[]
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()
  const { nodesMap } = useNodesMetaData()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const pendingRef = useRef(false)
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

  const openMigrationDialog = useCallback(() => {
    if (!canEdit || !policy.hasLegacyHumanInput) return
    setError(undefined)
    setDialogOpen(true)
  }, [canEdit, policy.hasLegacyHumanInput])

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(open)
    if (!open) setError(undefined)
  }, [])

  const migrationApi = useMemo(() => createHumanInputMigrationApi(), [])

  const replaceGraph = useCallback(
    (graph: { nodes: Node[]; edges: Edge[] }, source: string) => {
      collaborativeWorkflow.setNodes(graph.nodes, true, source)
    },
    [collaborativeWorkflow],
  )

  const handleConfirm = useCallback(async () => {
    if (pendingRef.current || !canEdit) return
    pendingRef.current = true
    setPending(true)
    setError(undefined)

    try {
      const result = await executeHumanInputV2Migration({
        getGraph: () => {
          const state = store.getState()
          return { nodes: state.getNodes() as Node[], edges: state.edges as Edge[] }
        },
        canApply: () => canApplyRef.current,
        migrationApi,
        replaceGraph,
        syncDraft: () => syncDraftOnce(doSyncWorkflowDraft),
        saveHistory: (migratedNodeIds) =>
          saveStateToHistory(WorkflowHistoryEvent.HumanInputMigration, {
            nodeId: migratedNodeIds[0],
          }),
      })

      if (result.status === 'blocked') {
        const firstBlocker = result.blockers[0]
        if (!firstBlocker) throw new Error('human-input-migration-invalid-response')
        const reason = t(($) => $[getBlockerTranslationKey(firstBlocker.code)], {
          ns: 'workflow',
        })
        const message = t(($) => $['nodes.humanInputMigration.error.blocked'], {
          ns: 'workflow',
          nodeTitle: firstBlocker.nodeTitle,
          reason,
        })
        setError(message)
        toast.error(message)
        return
      }

      if (result.status === 'graph-changed') {
        const message = t(($) => $['nodes.humanInputMigration.error.graphChanged'], {
          ns: 'workflow',
        })
        setError(message)
        toast.error(message)
        return
      }

      if (result.status === 'sync-error') {
        const message = t(($) => $['nodes.humanInputMigration.error.sync'], { ns: 'workflow' })
        setError(message)
        toast.error(message)
        return
      }

      setDialogOpen(false)
      if (result.status === 'success')
        toast.success(t(($) => $['nodes.humanInputMigration.success'], { ns: 'workflow' }))
    } catch {
      const message = t(($) => $['nodes.humanInputMigration.error.preflight'], { ns: 'workflow' })
      setError(message)
      toast.error(message)
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [canEdit, doSyncWorkflowDraft, migrationApi, replaceGraph, saveStateToHistory, store, t])

  const contextValue = useMemo(
    () => ({ policy, canEdit, pending, helpLink, openMigrationDialog }),
    [canEdit, helpLink, openMigrationDialog, pending, policy],
  )

  return (
    <HumanInputMigrationContext value={contextValue}>
      {children}
      {policy.hasLegacyHumanInput && (
        <div className="pointer-events-none absolute top-1 right-1 left-16 z-20">
          <HumanInputMigrationBanner
            canEdit={canEdit}
            helpLink={helpLink}
            onMigrate={openMigrationDialog}
          />
        </div>
      )}
      <HumanInputMigrationDialog
        open={dialogOpen && policy.hasLegacyHumanInput}
        pending={pending}
        nodeCount={legacyNodeCount}
        error={error}
        onOpenChange={handleDialogOpenChange}
        onConfirm={handleConfirm}
      />
    </HumanInputMigrationContext>
  )
}

export default HumanInputMigrationProvider
