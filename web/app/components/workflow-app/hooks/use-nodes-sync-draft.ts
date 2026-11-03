import type { WorkflowFeaturesConfigPayload } from '@dify/contracts/api/console/apps/types.gen'
import type {
  SyncDraftCallback,
  SyncDraftOptions,
  SyncDraftResult,
} from '@/app/components/workflow/hooks-store'
import type { WorkflowDraftSave } from '@/app/components/workflow/store/workflow/workflow-draft-slice'
import type { EnvironmentVariablePatch } from '@/service/workflow'
import { ORPCError, safe } from '@orpc/client'
import { skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useStore as useAtomStore, useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import {
  useNodesReadOnly,
  useNodesReadOnlyByCanEdit,
} from '@/app/components/workflow/hooks/use-workflow'
import {
  isAgentV2NodeData,
  needsInlineAgentBindingCreation,
} from '@/app/components/workflow/nodes/agent-v2/types'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { normalizeWorkflowNodes } from '@/app/components/workflow/utils/normalize-workflow-nodes'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { isAppDeletingOrDeleted } from '@/service/app-deletion'
import { consoleClient, consoleQuery } from '@/service/console'

const shouldSkipDraftSync = (
  appId: string | undefined,
  isWorkflowDataLoaded: boolean,
  isSyncingWorkflowDraft: boolean,
  hasWorkflowDraftConflict: boolean,
) =>
  !appId ||
  !isWorkflowDataLoaded ||
  isSyncingWorkflowDraft ||
  hasWorkflowDraftConflict ||
  isAppDeletingOrDeleted(appId)

const isEmptyGraph = (graph: { nodes: unknown[]; edges: unknown[] }) =>
  graph.nodes.length === 0 && graph.edges.length === 0

const toEnvironmentVariablePatchPayload = (patch: EnvironmentVariablePatch) => ({
  environment_variables: patch.environmentVariables,
  deleted_environment_variable_ids: patch.deletedEnvironmentVariableIds,
})

type LocalDraftSyncOptions = {
  preparingBuilder?: boolean
  force?: boolean
  keepalive?: boolean
}

const useNodesSyncDraftBase = (getNodesReadOnly: () => boolean) => {
  const { t } = useTranslation(['workflow'])
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const atomStore = useAtomStore()
  const featuresStore = useFeaturesStore()
  const appId = useAtomValue(workflowAppIdentityAtom).appId
  const { data: appMode } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: appId ? { params: { app_id: appId } } : skipToken,
      select: (app) => app.mode,
    }),
  )
  const { data: isCollaborationEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (s) => s.enable_collaboration_mode,
  })
  const isMountedRef = useRef(false)
  const emptySyncPendingRef = useRef(false)
  const cancelConfirmationRef = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      cancelConfirmationRef.current?.()
    }
  }, [])

  const getPostParams = useCallback(() => {
    const { getNodes, edges, transform } = store.getState()
    const allNodes = getNodes()
    const nodes = allNodes.filter((node) => {
      if (node.data?.type === BlockEnum.StartPlaceholder) return false

      if (!node.data?._isTempNode) return true

      return isAgentV2NodeData(node.data) && needsInlineAgentBindingCreation(node.data)
    })
    const skippedNodeIds = new Set(
      allNodes
        .filter((node) => {
          if (node.data?.type === BlockEnum.StartPlaceholder) return true

          if (!node.data?._isTempNode) return false

          return !(isAgentV2NodeData(node.data) && needsInlineAgentBindingCreation(node.data))
        })
        .map((node) => node.id),
    )
    const [x, y, zoom] = transform
    const {
      conversationVariables,
      syncWorkflowDraftHash,
      syncWorkflowDraftSaveId,
      isWorkflowDataLoaded,
      isSyncingWorkflowDraft,
      hasWorkflowDraftConflict,
      workflowDraftGeneration,
      workflowDraftLocalRevision,
    } = workflowStore.getState()

    if (
      !appId ||
      shouldSkipDraftSync(
        appId,
        isWorkflowDataLoaded,
        isSyncingWorkflowDraft,
        hasWorkflowDraftConflict,
      )
    )
      return null

    const features = featuresStore!.getState().features
    const producedNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        Object.keys(node.data).forEach((key) => {
          if (key.startsWith('_')) delete node.data[key]
        })
      })
    })
    const producedEdges = produce(
      edges.filter(
        (edge) =>
          !edge.data?._isTemp &&
          !skippedNodeIds.has(edge.source) &&
          !skippedNodeIds.has(edge.target),
      ),
      (draft) => {
        draft.forEach((edge) => {
          Object.keys(edge.data).forEach((key) => {
            if (key.startsWith('_')) delete edge.data[key]
          })
        })
      },
    )
    const featuresPayload: WorkflowFeaturesConfigPayload = {
      opening_statement: features.opening?.enabled ? features.opening?.opening_statement || '' : '',
      suggested_questions: features.opening?.enabled
        ? features.opening?.suggested_questions || []
        : [],
      suggested_questions_after_answer: features.suggested,
      text_to_speech: features.text2speech,
      speech_to_text: features.speech2text,
      retriever_resource: features.citation,
      sensitive_word_avoidance: features.moderation,
      file_upload: features.file,
    }

    return {
      appId,
      generation: workflowDraftGeneration,
      localRevision: workflowDraftLocalRevision,
      baseClientSaveId: syncWorkflowDraftSaveId,
      url: `/apps/${appId}/workflows/draft`,
      params: {
        graph: {
          nodes: normalizeWorkflowNodes(producedNodes, appMode),
          edges: producedEdges,
          viewport: {
            x,
            y,
            zoom,
          },
        },
        features: featuresPayload,
        conversation_variables: conversationVariables,
        hash: syncWorkflowDraftHash,
        ...(isCollaborationEnabled ? { _is_collaborative: true } : {}),
      },
    }
  }, [appId, store, featuresStore, workflowStore, isCollaborationEnabled, appMode])

  const performLocalSync = useCallback(
    async (
      baseParams: NonNullable<ReturnType<typeof getPostParams>>,
      save: WorkflowDraftSave,
      callback?: SyncDraftCallback,
      { preparingBuilder = false, force = false, keepalive = false }: LocalDraftSyncOptions = {},
    ): Promise<SyncDraftResult | null> => {
      if (
        !preparingBuilder &&
        (getNodesReadOnly() || workflowStore.getState().workflowDraftSyncPhase !== 'idle')
      ) {
        callback?.onSettled?.()
        return null
      }
      const isCurrent = () => {
        const state = workflowStore.getState()
        return (
          save.isCurrent() &&
          atomStore.get(workflowAppIdentityAtom).appId === baseParams.appId &&
          state.workflowDraftGeneration === baseParams.generation &&
          !shouldSkipDraftSync(
            baseParams.appId,
            state.isWorkflowDataLoaded,
            state.isSyncingWorkflowDraft,
            state.hasWorkflowDraftConflict,
          )
        )
      }
      if (!isCurrent()) {
        callback?.onSettled?.()
        return null
      }

      const canPersist =
        !isCollaborationEnabled ||
        (keepalive
          ? collaborationManager.canFlushGraphOnPageClose() ||
            collaborationManager.canUseLocalDraftFallback()
          : collaborationManager.canPersistLocalGraph())
      if (!canPersist) {
        callback?.onSettled?.()
        return null
      }

      let expectedHash = baseParams.params.hash
      let expectedSaveId = baseParams.baseClientSaveId
      const emptyGraph = isEmptyGraph(baseParams.params.graph)
      const canSaveEmptyGraph = () => {
        const currentParams = getPostParams()
        return (
          isMountedRef.current &&
          isCurrent() &&
          !getNodesReadOnly() &&
          (!isCollaborationEnabled || collaborationManager.canPersistLocalGraph()) &&
          currentParams?.url === baseParams.url &&
          isEmptyGraph(currentParams.params.graph)
        )
      }
      if (emptyGraph && force && !canSaveEmptyGraph()) {
        callback?.onSettled?.()
        return null
      }

      if (emptyGraph && force && isCollaborationEnabled) {
        // CRDT updates do not carry the persisted revision from another collaborator's save.
        const {
          syncWorkflowDraftHash: hashBeforeRefresh,
          syncWorkflowDraftSaveId: saveIdBeforeRefresh,
        } = workflowStore.getState()
        const [error, draft] = await safe(
          consoleClient.apps.byAppId.workflows.draft.get(
            { params: { app_id: baseParams.appId } },
            { context: { silent: true } },
          ),
        )
        if (!canSaveEmptyGraph()) {
          callback?.onSettled?.()
          return null
        }
        if (error || !Array.isArray(draft.graph.nodes) || !Array.isArray(draft.graph.edges)) {
          callback?.onError?.()
          callback?.onSettled?.()
          return null
        }

        const { syncWorkflowDraftHash, syncWorkflowDraftSaveId, setSyncWorkflowDraftHash } =
          workflowStore.getState()
        // Another hook may have saved a newer revision while this request was in flight.
        if (
          syncWorkflowDraftHash === hashBeforeRefresh &&
          syncWorkflowDraftSaveId === saveIdBeforeRefresh
        ) {
          expectedHash = draft.hash
          expectedSaveId = draft.client_save_id ?? null
          setSyncWorkflowDraftHash(
            draft.hash,
            { nodes: draft.graph.nodes, edges: draft.graph.edges },
            draft.client_save_id,
          )
        }
      }

      // Check after queued saves finish so a newly persisted nonempty draft is protected too.
      if (emptyGraph && force && workflowStore.getState().syncWorkflowDraftIsEmpty !== true) {
        const { showConfirm, setShowConfirm } = workflowStore.getState()
        if (!isMountedRef.current || showConfirm) {
          callback?.onSettled?.()
          return null
        }

        const confirmed = await new Promise<boolean>((resolve) => {
          let settled = false
          const finish = (confirmed: boolean) => {
            if (settled) return
            settled = true
            cancelConfirmationRef.current = undefined
            setShowConfirm(undefined)
            resolve(confirmed)
          }
          cancelConfirmationRef.current = () => finish(false)
          setShowConfirm({
            title: t(($) => $['common.clearCanvasConfirmTitle'], { ns: 'workflow' }),
            desc: t(($) => $['common.clearCanvasConfirmDescription'], { ns: 'workflow' }),
            onConfirm: () => finish(true),
            onCancel: () => finish(false),
          })
        })

        if (!confirmed || !canSaveEmptyGraph()) {
          callback?.onSettled?.()
          return null
        }
      }

      const { setSyncWorkflowDraftHash, setDraftUpdatedAt } = workflowStore.getState()

      try {
        const { syncWorkflowDraftHash: currentHash, syncWorkflowDraftSaveId: currentSaveId } =
          workflowStore.getState()
        const lastSave = workflowStore.getState().lastSavedWorkflowDraft
        // Only a successful save from this editor may advance a captured graph's
        // hash. A server refresh must never lend its hash to an older graph.
        const canUseLastSave =
          lastSave !== null &&
          lastSave.appId === baseParams.appId &&
          lastSave.generation === baseParams.generation &&
          lastSave.hash === currentHash &&
          lastSave.clientSaveId === currentSaveId
        if (currentHash !== expectedHash && !canUseLastSave) return null

        const submission = save.start()
        if (!submission) return null

        const baseClientSaveId = canUseLastSave ? lastSave.clientSaveId : expectedSaveId
        const body = {
          ...baseParams.params,
          hash: (canUseLastSave ? lastSave.hash : expectedHash) || null,
          client_save_id: submission.clientSaveId,
          ...(baseClientSaveId ? { base_client_save_id: baseClientSaveId } : {}),
          ...(submission.predecessorSaves.length > 0
            ? {
                predecessor_saves: submission.predecessorSaves.map((predecessor) => ({
                  client_save_id: predecessor.clientSaveId,
                  ...(predecessor.environmentVariablePatch
                    ? {
                        environment_variable_patch: toEnvironmentVariablePatchPayload(
                          predecessor.environmentVariablePatch,
                        ),
                      }
                    : {}),
                })),
              }
            : {}),
          ...(force ? { force: true } : {}),
          ...(submission.environmentVariablePatch
            ? {
                environment_variable_patch: toEnvironmentVariablePatchPayload(
                  submission.environmentVariablePatch,
                ),
              }
            : {}),
        }

        const [error, res, isDefined] = await safe(
          consoleClient.apps.byAppId.workflows.draft.post(
            { params: { app_id: baseParams.appId }, body },
            { context: { silent: true, ...(keepalive ? { keepalive: true } : {}) } },
          ),
        )
        if (!isCurrent()) return null
        if (error) {
          if (
            error instanceof ORPCError &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 408 &&
            error.status !== 429
          )
            save.reject()
          if (isDefined && error.code === 'draft_workflow_not_sync')
            workflowStore.getState().setWorkflowDraftConflict(true)
          callback?.onError?.()
          return null
        }
        if (
          workflowStore.getState().syncWorkflowDraftHash !== currentHash ||
          workflowStore.getState().syncWorkflowDraftSaveId !== currentSaveId
        )
          return null
        save.acknowledge()
        workflowStore.getState().setLastSavedWorkflowDraft({
          appId: baseParams.appId,
          generation: baseParams.generation,
          hash: res.hash,
          clientSaveId: res.client_save_id ?? null,
        })
        setSyncWorkflowDraftHash(res.hash, baseParams.params.graph, res.client_save_id)
        setDraftUpdatedAt(res.updated_at)
        workflowStore.getState().markWorkflowDraftSaved(baseParams.localRevision)
        callback?.onSuccess?.()
        return { hash: res.hash, updatedAt: res.updated_at, clientSaveId: res.client_save_id }
      } finally {
        callback?.onSettled?.()
      }
    },
    [atomStore, workflowStore, getNodesReadOnly, getPostParams, isCollaborationEnabled, t],
  )

  const doSyncWorkflowDraftLocally = useCallback(
    (
      baseParams: NonNullable<ReturnType<typeof getPostParams>>,
      callback?: SyncDraftCallback,
      options?: SyncDraftOptions,
      syncOptions: LocalDraftSyncOptions = {},
    ) =>
      workflowStore.getState().runWorkflowDraftSave(
        {
          appId: baseParams.appId,
          generation: baseParams.generation,
          keepalive: syncOptions.keepalive === true,
          environmentVariablePatch: options?.environmentVariablePatch,
        },
        (save) => {
          const drainingForBuilder = workflowStore.getState().workflowDraftSyncPhase !== 'idle'
          return performLocalSync(baseParams, save, callback, {
            ...syncOptions,
            preparingBuilder: syncOptions.preparingBuilder || drainingForBuilder,
          })
        },
      ),
    [performLocalSync, workflowStore],
  )

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly() || workflowStore.getState().workflowDraftSyncPhase !== 'idle') return

    const canPersist =
      !isCollaborationEnabled ||
      collaborationManager.canFlushGraphOnPageClose() ||
      collaborationManager.canUseLocalDraftFallback()
    if (!canPersist) return

    const snapshot = getPostParams()
    // Dispatch before teardown; queued reads and Builder still await this save.
    if (snapshot && !isEmptyGraph(snapshot.params.graph))
      void doSyncWorkflowDraftLocally(snapshot, undefined, undefined, { keepalive: true }).catch(
        () => undefined,
      )
  }, [
    doSyncWorkflowDraftLocally,
    getNodesReadOnly,
    getPostParams,
    isCollaborationEnabled,
    workflowStore,
  ])
  const doSyncWorkflowDraft = useCallback(
    async (
      _notRefreshWhenSyncError?: boolean,
      callback?: SyncDraftCallback,
      options?: SyncDraftOptions,
    ): Promise<SyncDraftResult | null> => {
      const {
        isWorkflowDataLoaded,
        isSyncingWorkflowDraft,
        workflowDraftGeneration,
        workflowDraftLocalRevision,
        hasWorkflowDraftConflict,
        workflowDraftSyncPhase,
      } = workflowStore.getState()
      // A follower awaiting the selected saver's ACK must still be able to
      // serve a directed save request. This wait never occupies the queue.
      const preparingBuilder =
        workflowDraftSyncPhase === 'preparing' && options?.forceLocal === true
      if (
        (!preparingBuilder && (getNodesReadOnly() || workflowDraftSyncPhase !== 'idle')) ||
        shouldSkipDraftSync(
          appId,
          isWorkflowDataLoaded,
          isSyncingWorkflowDraft,
          hasWorkflowDraftConflict,
        )
      ) {
        callback?.onSettled?.()
        return null
      }

      // Capture before ReactFlow resets its store during route unmount.
      const baseParams = getPostParams()
      if (!baseParams) {
        callback?.onSettled?.()
        return null
      }

      const emptyGraph = isEmptyGraph(baseParams.params.graph)
      if (
        emptyGraph &&
        (!isMountedRef.current ||
          emptySyncPendingRef.current ||
          workflowStore.getState().showConfirm)
      ) {
        callback?.onSettled?.()
        return null
      }

      const shouldRequestLeader =
        !emptyGraph &&
        isCollaborationEnabled &&
        collaborationManager.isConnected() &&
        !collaborationManager.getIsLeader() &&
        !options?.forceLocal

      if (!shouldRequestLeader) {
        if (emptyGraph) emptySyncPendingRef.current = true
        try {
          return await doSyncWorkflowDraftLocally(baseParams, callback, options, {
            preparingBuilder,
            force: emptyGraph,
          })
        } finally {
          if (emptyGraph) emptySyncPendingRef.current = false
        }
      }

      try {
        const result = await collaborationManager.requestWorkflowSync()
        if (
          atomStore.get(workflowAppIdentityAtom).appId !== appId ||
          workflowStore.getState().workflowDraftGeneration !== workflowDraftGeneration
        )
          return null
        const { setSyncWorkflowDraftHash, setDraftUpdatedAt } = workflowStore.getState()
        setSyncWorkflowDraftHash(result.hash, baseParams.params.graph, result.clientSaveId)
        setDraftUpdatedAt(result.updatedAt)
        workflowStore.getState().markWorkflowDraftSaved(workflowDraftLocalRevision)
        callback?.onSuccess?.()
        return result
      } catch (error) {
        const state = workflowStore.getState()
        if (
          atomStore.get(workflowAppIdentityAtom).appId === appId &&
          state.workflowDraftGeneration === workflowDraftGeneration &&
          !shouldSkipDraftSync(
            appId,
            state.isWorkflowDataLoaded,
            state.isSyncingWorkflowDraft,
            state.hasWorkflowDraftConflict,
          )
        ) {
          if (error instanceof Error && error.message === 'draft_workflow_not_sync')
            state.setWorkflowDraftConflict(true)
          callback?.onError?.()
        }
        return null
      } finally {
        callback?.onSettled?.()
      }
    },
    [
      appId,
      atomStore,
      doSyncWorkflowDraftLocally,
      getNodesReadOnly,
      getPostParams,
      isCollaborationEnabled,
      workflowStore,
    ],
  )

  const prepareWorkflowDraftForBuilder = useCallback(
    async (saveDraft: boolean, signal: AbortSignal) => {
      const state = workflowStore.getState()
      signal.throwIfAborted()
      // A replacement restore may take over a canceled request's barrier.
      if (saveDraft && state.workflowDraftSyncPhase !== 'idle')
        throw new Error(t(($) => $['common.syncingData']))
      if (state.hasWorkflowDraftConflict) throw new Error(t(($) => $['draftConflict.message']))

      const shouldSave = saveDraft && !state.canvasReadOnly
      if (shouldSave && getNodesReadOnly()) throw new Error(t(($) => $['common.draftSaveFailed']))
      const requestLeader =
        shouldSave &&
        isCollaborationEnabled &&
        collaborationManager.isConnected() &&
        !collaborationManager.getIsLeader()
      // Lock editing around this snapshot and retain it if ReactFlow unmounts
      // while older saves drain. An accepted save still finishes on cancellation.
      const snapshot = shouldSave ? getPostParams() : null
      state.debouncedSyncWorkflowDraft.cancel?.()
      state.setBuilderViewportManuallyChanged(false)
      state.setWorkflowDraftSyncPhase(shouldSave ? 'preparing' : 'builder')
      try {
        let saved: SyncDraftResult | null = null
        if (shouldSave && !requestLeader) {
          saved = snapshot
            ? await doSyncWorkflowDraftLocally(snapshot, undefined, undefined, {
                preparingBuilder: true,
              })
            : await state.enqueueWorkflowDraftOperation(async () => null)
        } else {
          await state.enqueueWorkflowDraftOperation(async () => undefined)
          signal.throwIfAborted()
          if (atomStore.get(workflowAppIdentityAtom).appId !== appId)
            throw new Error(t(($) => $['common.draftSaveFailed']))
          if (requestLeader) {
            const generation = workflowStore.getState().workflowDraftGeneration
            saved = await collaborationManager.requestWorkflowSync()
            signal.throwIfAborted()
            if (
              atomStore.get(workflowAppIdentityAtom).appId !== appId ||
              workflowStore.getState().workflowDraftGeneration !== generation
            )
              throw new Error(t(($) => $['common.draftSaveFailed']))
            state.setSyncWorkflowDraftHash(saved.hash, undefined, saved.clientSaveId)
            state.setDraftUpdatedAt(saved.updatedAt)
          }
        }
        signal.throwIfAborted()
        if (atomStore.get(workflowAppIdentityAtom).appId !== appId)
          throw new Error(t(($) => $['common.draftSaveFailed']))
        if (workflowStore.getState().hasWorkflowDraftConflict)
          throw new Error(t(($) => $['draftConflict.message']))
        if (shouldSave && !saved) throw new Error(t(($) => $['common.draftSaveFailed']))
        state.invalidateWorkflowDraftSync()
        state.setWorkflowDraftSyncPhase('builder')
      } catch (error) {
        if (atomStore.get(workflowAppIdentityAtom).appId === appId) {
          state.setWorkflowDraftSyncPhase(signal.aborted ? 'builder' : 'idle')
          if (error instanceof Error && error.message === 'draft_workflow_not_sync') {
            state.setWorkflowDraftConflict(true)
            throw new Error(t(($) => $['draftConflict.message']))
          }
        }
        throw error
      }
    },
    [
      appId,
      atomStore,
      doSyncWorkflowDraftLocally,
      getNodesReadOnly,
      getPostParams,
      isCollaborationEnabled,
      t,
      workflowStore,
    ],
  )

  return {
    doSyncWorkflowDraft,
    prepareWorkflowDraftForBuilder,
    syncWorkflowDraftWhenPageClose,
  }
}

export const useNodesSyncDraftByCanEdit = (canEdit: boolean) => {
  const { getNodesReadOnly } = useNodesReadOnlyByCanEdit(canEdit)

  return useNodesSyncDraftBase(getNodesReadOnly)
}

export const useNodesSyncDraft = () => {
  const { getNodesReadOnly } = useNodesReadOnly()

  return useNodesSyncDraftBase(getNodesReadOnly)
}
