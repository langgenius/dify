import type { PropsWithChildren } from 'react'
import type { HumanInputMigrationBlocker } from './types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { toast } from '@langgenius/dify-ui/toast'
import { cloneDeep } from 'es-toolkit/object'
import { useCallback, useMemo, useRef, useState } from 'react'
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
import { useMembers } from '@/service/use-common'
import { mockContactRecipientOptionProvider } from '../contact-provider'
import { HumanInputMigrationContext } from './context'
import { executeHumanInputV2Migration } from './executor'
import HumanInputMigrationBanner from './migration-banner'
import HumanInputMigrationDialog from './migration-dialog'
import { createMockHumanInputMigrationApi } from './mock-api'
import { getHumanInputCreationPolicy } from './policy'
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

const syncDraftOnce = (
  doSyncWorkflowDraft: ReturnType<typeof useNodesSyncDraft>['doSyncWorkflowDraft'],
) =>
  new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }

    void doSyncWorkflowDraft(true, {
      onError: () => finish(() => reject(new Error('human-input-migration-sync-failed'))),
      onSettled: () => finish(resolve),
    }).then(
      () => finish(resolve),
      (error) => finish(() => reject(error)),
    )
  })

const HumanInputMigrationProvider = ({ children, canEdit }: HumanInputMigrationProviderProps) => {
  const { t } = useTranslation()
  const nodes = useNodes() as Node[]
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { saveStateToHistory } = useWorkflowHistory()
  const { nodesMap } = useNodesMetaData()
  const { data: membersData } = useMembers()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const pendingRef = useRef(false)
  const policy = useMemo(() => getHumanInputCreationPolicy(nodes, canEdit), [canEdit, nodes])
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

  const getResolverSnapshot = useCallback(async () => {
    const members = cloneDeep(membersData?.accounts ?? []).map((member) => ({
      id: member.id,
      email: member.email,
    }))
    const contacts = (await mockContactRecipientOptionProvider.search('')).map((contact) => ({
      id: contact.id,
      email: contact.email,
    }))
    return { members, contacts }
  }, [membersData?.accounts])
  const migrationApi = useMemo(
    () => createMockHumanInputMigrationApi(getResolverSnapshot),
    [getResolverSnapshot],
  )

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
        migrationApi,
        replaceGraph,
        syncDraft: () => syncDraftOnce(doSyncWorkflowDraft),
        saveHistory: (migratedNodeIds) =>
          saveStateToHistory(WorkflowHistoryEvent.HumanInputMigration, {
            nodeId: migratedNodeIds[0],
          }),
      })

      if (result.status === 'blocked') {
        const firstBlocker = result.blockers[0]!
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
        <div className="pointer-events-none absolute top-14 left-1/2 z-20 -translate-x-1/2 px-4">
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
        error={error}
        onOpenChange={handleDialogOpenChange}
        onConfirm={handleConfirm}
      />
    </HumanInputMigrationContext>
  )
}

export default HumanInputMigrationProvider
