import type { WorkflowFeaturesConfigPayload } from '@dify/contracts/api/console/apps/types.gen'
import type {
  SyncDraftCallback,
  SyncDraftOptions,
  SyncDraftResult,
} from '@/app/components/workflow/hooks-store'
import { safe } from '@orpc/client'
import { skipToken, useQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useStore as useAtomStore, useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { useWorkflowAppStore as useWorkflowStore } from '@/app/components/workflow-app/store/workflow'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import {
  editorCollaborationEnabledAtom,
  workflowAppIdentityAtom,
} from '@/app/components/workflow/editor-resource/state'
import {
  useNodesReadOnly,
  useNodesReadOnlyByCanEdit,
} from '@/app/components/workflow/hooks/use-workflow'
import {
  isAgentV2NodeData,
  needsInlineAgentBindingCreation,
} from '@/app/components/workflow/nodes/agent-v2/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { normalizeWorkflowNodes } from '@/app/components/workflow/utils/normalize-workflow-nodes'
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
  const isCollaborationEnabled = useAtomValue(editorCollaborationEnabledAtom)
  const isMountedRef = useRef(false)
  const emptySyncPendingRef = useRef(false)
  const cancelConfirmationRef = useRef<(() => void) | undefined>(undefined)
  const builderPreparationRef = useRef<AbortSignal | null>(null)

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
      initialPlaceholder:
        appMode === 'workflow' &&
        allNodes.length === 1 &&
        allNodes[0]?.data?.type === BlockEnum.StartPlaceholder &&
        edges.length === 0,
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
      callback?: SyncDraftCallback,
      options?: SyncDraftOptions,
      {
        preparingBuilder = false,
        force = false,
        keepalive = false,
      }: { preparingBuilder?: boolean; force?: boolean; keepalive?: boolean } = {},
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
        const hashBeforeRefresh = workflowStore.getState().syncWorkflowDraftHash
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

        const { syncWorkflowDraftHash, setSyncWorkflowDraftHash } = workflowStore.getState()
        // Another hook may have saved a newer revision while this request was in flight.
        if (syncWorkflowDraftHash === hashBeforeRefresh) {
          expectedHash = draft.hash
          setSyncWorkflowDraftHash(draft.hash, {
            nodes: draft.graph.nodes,
            edges: draft.graph.edges,
          })
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
        const currentHash = workflowStore.getState().syncWorkflowDraftHash
        const lastSave = workflowStore.getState().lastSavedWorkflowDraft
        // Only a successful save from this editor may advance a captured graph's
        // hash. A server refresh must never lend its hash to an older graph.
        const canUseLastSave =
          lastSave !== null &&
          lastSave.appId === baseParams.appId &&
          lastSave.generation === baseParams.generation &&
          lastSave.hash === currentHash
        if (currentHash !== expectedHash && !canUseLastSave) return null

        const body = {
          ...baseParams.params,
          hash: (canUseLastSave ? lastSave.hash : expectedHash) || null,
          ...(force ? { force: true } : {}),
          ...(options?.environmentVariablePatch
            ? {
                environment_variable_patch: {
                  environment_variables: options.environmentVariablePatch.environmentVariables,
                  deleted_environment_variable_ids:
                    options.environmentVariablePatch.deletedEnvironmentVariableIds,
                },
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
        if (workflowStore.getState().syncWorkflowDraftHash !== currentHash) return null
        if (error) {
          if (isDefined && error.code === 'draft_workflow_not_sync')
            workflowStore.getState().setWorkflowDraftConflict(true)
          callback?.onError?.()
          return null
        }
        workflowStore.getState().setLastSavedWorkflowDraft({
          appId: baseParams.appId,
          generation: baseParams.generation,
          hash: res.hash,
        })
        setSyncWorkflowDraftHash(res.hash, baseParams.params.graph)
        setDraftUpdatedAt(res.updated_at)
        workflowStore.getState().markWorkflowDraftSaved(baseParams.localRevision)
        callback?.onSuccess?.()
        return { hash: res.hash, updatedAt: res.updated_at }
      } finally {
        callback?.onSettled?.()
      }
    },
    [atomStore, workflowStore, getNodesReadOnly, getPostParams, isCollaborationEnabled, t],
  )

  const doSyncWorkflowDraftLocally = useCallback(
    (...args: Parameters<typeof performLocalSync>) =>
      workflowStore.getState().enqueueWorkflowDraftOperation(() => {
        // Saves accepted before the barrier must finish, including variable
        // patches that cannot be reconstructed from the final canvas snapshot.
        const drainingForBuilder = workflowStore.getState().workflowDraftSyncPhase !== 'idle'
        return performLocalSync(args[0], args[1], args[2], {
          ...args[3],
          preparingBuilder: args[3]?.preparingBuilder || drainingForBuilder,
        })
      }),
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
    // Send before teardown, while keeping later reads and Builder behind this request.
    if (snapshot && !isEmptyGraph(snapshot.params.graph))
      void workflowStore
        .getState()
        .runWorkflowDraftOperationImmediately(() =>
          performLocalSync(snapshot, undefined, undefined, { keepalive: true }),
        )
        .catch(() => undefined)
  }, [getNodesReadOnly, getPostParams, isCollaborationEnabled, performLocalSync, workflowStore])
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
            force: emptyGraph && !baseParams.initialPlaceholder,
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
        setSyncWorkflowDraftHash(result.hash, baseParams.params.graph)
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

  const releaseWorkflowDraftFromBuilder = useCallback(() => {
    const state = workflowStore.getState()
    if (state.workflowDraftSyncPhase === 'idle' || state.workflowDraftSyncPhase === 'releasing')
      return

    builderPreparationRef.current = null
    state.setWorkflowDraftSyncPhase('releasing')
    void state.enqueueWorkflowDraftOperation(async () => {
      state.setWorkflowDraftSyncPhase('idle')
      const { workflowDraftLocalRevision, workflowDraftSavedRevision, debouncedSyncWorkflowDraft } =
        workflowStore.getState()
      if (workflowDraftLocalRevision > workflowDraftSavedRevision)
        debouncedSyncWorkflowDraft(doSyncWorkflowDraft)
    })
  }, [doSyncWorkflowDraft, workflowStore])

  const prepareWorkflowDraftForBuilder = useCallback(
    async (saveDraft: boolean, signal: AbortSignal) => {
      const state = workflowStore.getState()
      signal.throwIfAborted()
      // A replacement restore may take over a canceled request's barrier.
      if (
        state.workflowDraftSyncPhase === 'releasing' ||
        (saveDraft && state.workflowDraftSyncPhase !== 'idle')
      )
        throw new Error(t(($) => $['common.syncingData']))
      if (state.hasWorkflowDraftConflict) throw new Error(t(($) => $['draftConflict.message']))

      const hasUnsavedEdits = state.workflowDraftLocalRevision > state.workflowDraftSavedRevision
      const shouldSave = (saveDraft || hasUnsavedEdits) && !state.canvasReadOnly
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
      builderPreparationRef.current = signal
      state.setWorkflowDraftSyncPhase(shouldSave ? 'preparing' : 'builder')
      try {
        let saved: SyncDraftResult | null = null
        if (shouldSave && !requestLeader) {
          saved = await state.enqueueWorkflowDraftOperation(async () =>
            snapshot
              ? performLocalSync(snapshot, undefined, undefined, { preparingBuilder: true })
              : null,
          )
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
            state.setSyncWorkflowDraftHash(saved.hash)
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
        if (
          builderPreparationRef.current === signal &&
          atomStore.get(workflowAppIdentityAtom).appId === appId
        ) {
          state.setWorkflowDraftSyncPhase(signal.aborted ? 'builder' : 'idle')
          if (error instanceof Error && error.message === 'draft_workflow_not_sync') {
            state.setWorkflowDraftConflict(true)
            throw new Error(t(($) => $['draftConflict.message']))
          }
        }
        throw error
      } finally {
        if (builderPreparationRef.current === signal) builderPreparationRef.current = null
      }
    },
    [
      appId,
      atomStore,
      getNodesReadOnly,
      getPostParams,
      isCollaborationEnabled,
      performLocalSync,
      t,
      workflowStore,
    ],
  )

  return {
    doSyncWorkflowDraft,
    prepareWorkflowDraftForBuilder,
    releaseWorkflowDraftFromBuilder,
    syncWorkflowDraftWhenPageClose,
  }
}

export const useWorkflowDraftSaveByCanEdit = (canEdit: boolean) => {
  const { getNodesReadOnly } = useNodesReadOnlyByCanEdit(canEdit)

  return useNodesSyncDraftBase(getNodesReadOnly)
}

export const useWorkflowDraftSave = () => {
  const { getNodesReadOnly } = useNodesReadOnly()

  return useNodesSyncDraftBase(getNodesReadOnly)
}
