import type { Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type {
  EnvironmentVariable,
  LLMEnvironmentVariableValue,
} from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { RiCloseLine } from '@remixicon/react'
import { cloneDeep } from 'es-toolkit/object'
import { isEqual } from 'es-toolkit/predicate'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
import {
  findUsedVarNodes,
  updateNodeVars,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import EnvItem from '@/app/components/workflow/panel/env-panel/env-item'
import VariableTrigger from '@/app/components/workflow/panel/env-panel/variable-trigger'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { Resolution } from '@/types/app'
import {
  fetchModelParameterRulesForModel,
  mergeValidCompletionParams,
} from '@/utils/completion-params'

const HIDDEN_SECRET_VALUE = '[__HIDDEN__]'

type EnvironmentVariablePatch = {
  environmentVariables: EnvironmentVariable[]
  deletedEnvironmentVariableIds: string[]
}

const formatSecret = (secret: string) => {
  return secret.length > 8
    ? `${secret.slice(0, 6)}************${secret.slice(-2)}`
    : '********************'
}

const sanitizeSecretValue = (env: EnvironmentVariable) => {
  return env.value_type === 'secret' ? { ...env, value: HIDDEN_SECRET_VALUE } : env
}

const removeSecretFromMap = (secretMap: Record<string, string>, envId: string) => {
  const nextSecretMap = { ...secretMap }
  delete nextSecretMap[envId]
  return nextSecretMap
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const restoreChangedValue = (current: unknown, previous: unknown, changed: unknown): unknown => {
  if (isEqual(previous, changed)) return current
  if (isEqual(current, changed)) return cloneDeep(previous)
  if (!isRecord(current) || !isRecord(previous) || !isRecord(changed)) return current

  const restored = { ...current }
  const keys = new Set([...Object.keys(previous), ...Object.keys(changed)])
  keys.forEach((key) => {
    const hadPrevious = Object.hasOwn(previous, key)
    const hadChanged = Object.hasOwn(changed, key)
    const hasCurrent = Object.hasOwn(current, key)

    if (!hadPrevious && hadChanged) {
      if (hasCurrent && isEqual(current[key], changed[key])) delete restored[key]
      return
    }
    if (hadPrevious && !hadChanged) {
      if (!hasCurrent) restored[key] = cloneDeep(previous[key])
      return
    }
    restored[key] = restoreChangedValue(current[key], previous[key], changed[key])
  })
  return restored
}

const mergeUntouchedEnvironmentVariables = (
  committedEnvList: EnvironmentVariable[],
  latestEnvList: EnvironmentVariable[],
  pendingEnvIds: Set<string>,
) => {
  const committedById = new Map(committedEnvList.map((env) => [env.id, env]))
  const latestIds = new Set(latestEnvList.map((env) => env.id))
  const mergedEnvList = latestEnvList.flatMap((env) => {
    if (!pendingEnvIds.has(env.id)) return [env]
    const committedEnv = committedById.get(env.id)
    return committedEnv ? [committedEnv] : []
  })

  committedEnvList.forEach((env) => {
    if (pendingEnvIds.has(env.id) && !latestIds.has(env.id)) mergedEnvList.push(env)
  })
  return mergedEnvList
}

const environmentVariablePatchMatches = (
  environmentVariables: EnvironmentVariable[],
  patch: EnvironmentVariablePatch,
) => {
  const variablesById = new Map(
    environmentVariables.map((variable) => [variable.id, sanitizeSecretValue(variable)]),
  )
  const upsertsMatch = patch.environmentVariables.every((variable) =>
    isEqual(variablesById.get(variable.id), sanitizeSecretValue(variable)),
  )
  const deletionsMatch = patch.deletedEnvironmentVariableIds.every(
    (variableId) => !variablesById.has(variableId),
  )
  return upsertsMatch && deletionsMatch
}

const environmentVariableGraphPatchMatches = (
  environmentVariables: EnvironmentVariable[],
  patch: EnvironmentVariablePatch,
) => {
  const variablesById = new Map(environmentVariables.map((variable) => [variable.id, variable]))
  const upsertsMatch = patch.environmentVariables.every((variable) => {
    const persistedVariable = variablesById.get(variable.id)
    if (
      !persistedVariable ||
      persistedVariable.name !== variable.name ||
      persistedVariable.value_type !== variable.value_type
    )
      return false
    if (variable.value_type !== 'llm') return true
    return isEqual(persistedVariable.value, variable.value)
  })
  const deletionsMatch = patch.deletedEnvironmentVariableIds.every(
    (variableId) => !variablesById.has(variableId),
  )
  return upsertsMatch && deletionsMatch
}

const getLLMEnvironmentValue = (
  variable: EnvironmentVariable,
): LLMEnvironmentVariableValue | undefined => {
  if (variable.value_type !== 'llm' || !variable.value || typeof variable.value !== 'object')
    return undefined

  const value = variable.value as Partial<LLMEnvironmentVariableValue>
  if (!value.provider || !value.name || !value.mode) return undefined
  return value as LLMEnvironmentVariableValue
}

const useEnvPanelActions = ({
  collaborativeWorkflow,
  workflowStore,
  appId,
  updateEnvList,
  setEnvSecrets,
  setControlPromptEditorRerenderKey,
  activeTextGenerationModelList,
}: {
  collaborativeWorkflow: ReturnType<typeof useCollaborativeWorkflow>
  workflowStore: ReturnType<typeof useWorkflowStore>
  appId: string
  updateEnvList: (envList: EnvironmentVariable[]) => void
  setEnvSecrets: (envSecrets: Record<string, string>) => void
  setControlPromptEditorRerenderKey: (controlPromptEditorRerenderKey: number) => void
  activeTextGenerationModelList: Model[]
}) => {
  const emitVarsAndFeaturesUpdate = useCallback(
    async (syncWorkflowDraft = false) => {
      try {
        const { webSocketClient } =
          await import('@/app/components/workflow/collaboration/core/websocket-manager')
        const socket = webSocketClient.getSocket(appId)
        if (socket) {
          socket.emit('collaboration_event', {
            type: 'vars_and_features_update',
            ...(syncWorkflowDraft ? { data: { syncWorkflowDraft: true } } : {}),
          })
        }
      } catch (error) {
        console.error('Failed to emit vars_and_features_update event:', error)
      }
    },
    [appId],
  )

  const persistEnvironmentVariables = useCallback(
    async (patch: EnvironmentVariablePatch, syncWorkflowDraft = false) => {
      try {
        const { updateEnvironmentVariables } = await import('@/service/workflow')
        await updateEnvironmentVariables({
          appId,
          ...patch,
        })
        await emitVarsAndFeaturesUpdate(syncWorkflowDraft)
        return true
      } catch (error) {
        console.error('Failed to update environment variables:', error)
        return false
      }
    },
    [appId, emitVarsAndFeaturesUpdate],
  )

  const fetchPersistedEnvironmentVariables = useCallback(async () => {
    try {
      const { fetchWorkflowDraft } = await import('@/service/workflow')
      const workflow = await fetchWorkflowDraft(`/apps/${appId}/workflows/draft`)
      return workflow.environment_variables
    } catch (error) {
      console.error('Failed to refresh environment variables:', error)
      return undefined
    }
  }, [appId])

  const getAffectedNodes = useCallback(
    (env: EnvironmentVariable) => {
      const { nodes: allNodes } = collaborativeWorkflow.getState()
      return findUsedVarNodes(['env', env.name], allNodes)
    },
    [collaborativeWorkflow],
  )

  const updateAffectedNodes = useCallback(
    (currentEnv: EnvironmentVariable, nextSelector: string[]) => {
      const { nodes, setNodes } = collaborativeWorkflow.getState()
      const affectedNodes = getAffectedNodes(currentEnv)
      if (affectedNodes.length === 0) return undefined

      const nextNodes = nodes.map((node) => {
        if (affectedNodes.find((affectedNode) => affectedNode.id === node.id))
          return updateNodeVars(node, ['env', currentEnv.name], nextSelector)

        return node
      })
      setNodes(nextNodes)
      setControlPromptEditorRerenderKey(Date.now())
      const previousNodesById = new Map(nodes.map((node) => [node.id, node]))
      const changedNodesById = new Map(nextNodes.map((node) => [node.id, node]))
      return () => {
        const { nodes: latestNodes, setNodes: setLatestNodes } = collaborativeWorkflow.getState()
        let hasRestoredNode = false
        const restoredNodes = latestNodes.map((node) => {
          const previousNode = previousNodesById.get(node.id)
          const changedNode = changedNodesById.get(node.id)
          if (!previousNode || !changedNode || isEqual(previousNode.data, changedNode.data))
            return node

          const restoredData = restoreChangedValue(
            node.data,
            previousNode.data,
            changedNode.data,
          ) as typeof node.data
          if (isEqual(restoredData, node.data)) return node
          hasRestoredNode = true
          return { ...node, data: restoredData }
        })
        if (hasRestoredNode) setLatestNodes(restoredNodes)
      }
    },
    [collaborativeWorkflow, getAffectedNodes, setControlPromptEditorRerenderKey],
  )

  const prepareAffectedLLMNodeReconciliation = useCallback(
    async (currentEnv: EnvironmentVariable, nextEnv: EnvironmentVariable) => {
      const currentModel = getLLMEnvironmentValue(currentEnv)
      const nextModel = getLLMEnvironmentValue(nextEnv)
      if (!currentModel || !nextModel) return undefined
      if (
        currentModel.provider === nextModel.provider &&
        currentModel.name === nextModel.name &&
        currentModel.mode === nextModel.mode
      )
        return undefined

      const affectedNodes = getAffectedNodes(currentEnv).filter(
        (node) =>
          node.data.type === BlockEnum.LLM &&
          (node.data as LLMNodeType).model_selector?.join('.') === `env.${currentEnv.name}`,
      )
      if (affectedNodes.length === 0) return undefined
      const targetModel = activeTextGenerationModelList
        .find((provider) => provider.provider === nextModel.provider)
        ?.models.find((model) => model.model === nextModel.name)
      const supportsVision = !!targetModel?.features?.includes(ModelFeatureEnum.vision)
      const parameterRules = await fetchModelParameterRulesForModel(
        nextModel.provider,
        nextModel.name,
      )

      return () => {
        const { nodes, setNodes } = collaborativeWorkflow.getState()
        let hasReconciledNode = false
        const nextNodes = nodes.map((node) => {
          if (
            node.data.type !== BlockEnum.LLM ||
            (node.data as LLMNodeType).model_selector?.join('.') !== `env.${currentEnv.name}`
          )
            return node

          hasReconciledNode = true
          const data = node.data as LLMNodeType
          const completionParams = mergeValidCompletionParams(
            data.model.completion_params,
            parameterRules,
            true,
          ).params
          const vision = !supportsVision
            ? { enabled: false }
            : data.vision?.enabled
              ? {
                  enabled: true,
                  configs: {
                    detail: Resolution.high,
                    variable_selector: [],
                  },
                }
              : data.vision

          return {
            ...node,
            data: {
              ...data,
              model: {
                ...data.model,
                provider: nextModel.provider,
                name: nextModel.name,
                completion_params: completionParams,
              },
              vision,
            },
          }
        })
        if (!hasReconciledNode) return undefined

        setNodes(nextNodes)
        setControlPromptEditorRerenderKey(Date.now())
        const previousNodesById = new Map(nodes.map((node) => [node.id, node]))
        const changedNodesById = new Map(nextNodes.map((node) => [node.id, node]))
        return () => {
          const { nodes: latestNodes, setNodes: setLatestNodes } = collaborativeWorkflow.getState()
          let hasRestoredNode = false
          const restoredNodes = latestNodes.map((node) => {
            const previousNode = previousNodesById.get(node.id)
            const changedNode = changedNodesById.get(node.id)
            if (!previousNode || !changedNode || isEqual(previousNode.data, changedNode.data))
              return node

            const restoredData = restoreChangedValue(
              node.data,
              previousNode.data,
              changedNode.data,
            ) as typeof node.data
            if (isEqual(restoredData, node.data)) return node
            hasRestoredNode = true
            return { ...node, data: restoredData }
          })
          if (hasRestoredNode) setLatestNodes(restoredNodes)
        }
      }
    },
    [
      activeTextGenerationModelList,
      collaborativeWorkflow,
      getAffectedNodes,
      setControlPromptEditorRerenderKey,
    ],
  )
  const syncEnvList = useCallback(
    async (
      nextEnvList: EnvironmentVariable[],
      patch: EnvironmentVariablePatch,
      syncWorkflowDraft = false,
    ) => {
      updateEnvList(nextEnvList)
      const persisted = await persistEnvironmentVariables(patch, syncWorkflowDraft)
      return persisted
    },
    [persistEnvironmentVariables, updateEnvList],
  )

  const saveSecretValue = useCallback(
    (env: EnvironmentVariable) => {
      const latestEnvSecrets = workflowStore.getState().envSecrets
      setEnvSecrets({
        ...latestEnvSecrets,
        [env.id]: formatSecret(String(env.value)),
      })
    },
    [setEnvSecrets, workflowStore],
  )

  const removeEnvSecret = useCallback(
    (envId: string) => {
      setEnvSecrets(removeSecretFromMap(workflowStore.getState().envSecrets, envId))
    },
    [setEnvSecrets, workflowStore],
  )

  return {
    emitVarsAndFeaturesUpdate,
    fetchPersistedEnvironmentVariables,
    getAffectedNodes,
    prepareAffectedLLMNodeReconciliation,
    updateAffectedNodes,
    syncEnvList,
    saveSecretValue,
    removeEnvSecret,
  }
}

const EnvPanel = () => {
  const { t } = useTranslation()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const workflowStore = useWorkflowStore()
  const setShowEnvPanel = useStore((s) => s.setShowEnvPanel)
  const envList = useStore((s) => s.environmentVariables) as EnvironmentVariable[]
  const updateEnvList = useStore((s) => s.setEnvironmentVariables)
  const setEnvSecrets = useStore((s) => s.setEnvSecrets)
  const setControlPromptEditorRerenderKey = useStore((s) => s.setControlPromptEditorRerenderKey)
  const appId = useStore((s) => s.appId) as string
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { activeTextGenerationModelList } = useTextGenerationCurrentProviderAndModelAndModelList()
  const {
    emitVarsAndFeaturesUpdate,
    fetchPersistedEnvironmentVariables,
    getAffectedNodes,
    prepareAffectedLLMNodeReconciliation,
    updateAffectedNodes,
    syncEnvList,
    saveSecretValue,
    removeEnvSecret,
  } = useEnvPanelActions({
    collaborativeWorkflow,
    workflowStore,
    appId,
    updateEnvList,
    setEnvSecrets,
    setControlPromptEditorRerenderKey,
    activeTextGenerationModelList,
  })

  const [showVariableModal, setShowVariableModal] = useState(false)
  const [currentVar, setCurrentVar] = useState<EnvironmentVariable>()

  const [showRemoveVarConfirm, setShowRemoveVarConfirm] = useState(false)
  const [cacheForDelete, setCacheForDelete] = useState<EnvironmentVariable>()
  const saveOperationQueueRef = useRef(Promise.resolve())
  const committedEnvListRef = useRef(envList)
  const latestEnvListRef = useRef(envList)
  const pendingSaveEnvIdsRef = useRef(new Map<string, number>())
  latestEnvListRef.current = envList

  useEffect(() => {
    if (pendingSaveEnvIdsRef.current.size === 0) committedEnvListRef.current = envList
  }, [envList])

  const mergeLatestUntouchedEnvList = useCallback((envListToMerge: EnvironmentVariable[]) => {
    return mergeUntouchedEnvironmentVariables(
      envListToMerge,
      latestEnvListRef.current,
      new Set(pendingSaveEnvIdsRef.current.keys()),
    )
  }, [])

  const restoreCommittedEnvList = useCallback(() => {
    committedEnvListRef.current = mergeLatestUntouchedEnvList(committedEnvListRef.current)
    updateEnvList(committedEnvListRef.current)
  }, [mergeLatestUntouchedEnvList, updateEnvList])

  const reconcileAmbiguousPersistenceFailure = useCallback(
    async (patch: EnvironmentVariablePatch) => {
      const persistedEnvList = await fetchPersistedEnvironmentVariables()
      if (!persistedEnvList) {
        if (!environmentVariablePatchMatches(latestEnvListRef.current, patch)) {
          committedEnvListRef.current = latestEnvListRef.current.map(sanitizeSecretValue)
          updateEnvList(committedEnvListRef.current)
          return false
        }
        restoreCommittedEnvList()
        return false
      }

      committedEnvListRef.current = persistedEnvList.map(sanitizeSecretValue)
      updateEnvList(committedEnvListRef.current)
      return environmentVariablePatchMatches(persistedEnvList, patch)
    },
    [fetchPersistedEnvironmentVariables, restoreCommittedEnvList, updateEnvList],
  )

  const commitPersistedEnvList = useCallback(
    async (nextEnvList: EnvironmentVariable[], patch: EnvironmentVariablePatch) => {
      const persistedEnvList = collaborationManager.isConnected()
        ? await fetchPersistedEnvironmentVariables()
        : undefined
      committedEnvListRef.current = (
        persistedEnvList ?? mergeLatestUntouchedEnvList(nextEnvList)
      ).map(sanitizeSecretValue)
      updateEnvList(committedEnvListRef.current)
      return !persistedEnvList || environmentVariableGraphPatchMatches(persistedEnvList, patch)
    },
    [fetchPersistedEnvironmentVariables, mergeLatestUntouchedEnvList, updateEnvList],
  )

  const enqueueSaveOperation = useCallback(
    (envId: string, operation: () => Promise<void>) => {
      pendingSaveEnvIdsRef.current.set(envId, (pendingSaveEnvIdsRef.current.get(envId) ?? 0) + 1)
      const runOperation = async () => {
        committedEnvListRef.current = mergeLatestUntouchedEnvList(committedEnvListRef.current)
        try {
          await operation()
        } finally {
          const pendingCount = pendingSaveEnvIdsRef.current.get(envId) ?? 0
          if (pendingCount <= 1) pendingSaveEnvIdsRef.current.delete(envId)
          else pendingSaveEnvIdsRef.current.set(envId, pendingCount - 1)
        }
      }
      const queuedOperation = saveOperationQueueRef.current.then(runOperation, runOperation)
      saveOperationQueueRef.current = queuedOperation.catch(() => undefined)
      return queuedOperation
    },
    [mergeLatestUntouchedEnvList],
  )

  const syncDraftWithResult = useCallback(
    async (environmentVariablePatch?: EnvironmentVariablePatch) => {
      let succeeded = false
      try {
        await doSyncWorkflowDraft(
          false,
          {
            onSuccess: () => {
              succeeded = true
            },
            onError: () => {
              succeeded = false
            },
          },
          environmentVariablePatch ? { environmentVariablePatch } : undefined,
        )
      } catch {
        succeeded = false
      }
      return succeeded
    },
    [doSyncWorkflowDraft],
  )

  const persistQueuedEnvList = useCallback(
    async (nextEnvList: EnvironmentVariable[], patch: EnvironmentVariablePatch) => {
      const persisted = await syncEnvList(nextEnvList, patch)
      if (persisted) return { persisted: true, usedDraftFallback: false }

      const fallbackPersisted = await syncDraftWithResult(patch)
      if (fallbackPersisted) await emitVarsAndFeaturesUpdate()
      return {
        persisted: fallbackPersisted,
        usedDraftFallback: true,
      }
    },
    [emitVarsAndFeaturesUpdate, syncDraftWithResult, syncEnvList],
  )

  const persistEnvListWithGraphChanges = useCallback(
    async (nextEnvList: EnvironmentVariable[], patch: EnvironmentVariablePatch) => {
      const isCollaborationFollower =
        collaborationManager.isConnected() && !collaborationManager.getIsLeader()
      if (isCollaborationFollower) return syncEnvList(nextEnvList, patch, true)

      const persisted = await syncDraftWithResult(patch)
      if (persisted) await emitVarsAndFeaturesUpdate()
      return persisted
    },
    [emitVarsAndFeaturesUpdate, syncDraftWithResult, syncEnvList],
  )

  const handleEdit = (env: EnvironmentVariable) => {
    setCurrentVar(env)
    setShowVariableModal(true)
  }

  const handleDelete = useCallback(
    async (env: EnvironmentVariable) => {
      setCacheForDelete(undefined)
      setShowRemoveVarConfirm(false)
      await enqueueSaveOperation(env.id, async () => {
        const committedEnv = committedEnvListRef.current.find((item) => item.id === env.id)
        if (!committedEnv) return

        const nextEnvList = committedEnvListRef.current.filter((item) => item.id !== env.id)
        const patch: EnvironmentVariablePatch = {
          environmentVariables: [],
          deletedEnvironmentVariableIds: [committedEnv.id],
        }
        updateEnvList(nextEnvList)
        const rollbackAffectedNodes = updateAffectedNodes(committedEnv, [])
        const persisted = rollbackAffectedNodes
          ? await persistEnvListWithGraphChanges(nextEnvList, patch)
          : (await persistQueuedEnvList(nextEnvList, patch)).persisted
        if (!persisted) {
          const recovered = await reconcileAmbiguousPersistenceFailure(patch)
          if (!recovered) {
            rollbackAffectedNodes?.()
            toast.error(t(($) => $.error, { ns: 'common' }))
          }
          if (recovered)
            await emitVarsAndFeaturesUpdate(
              !!rollbackAffectedNodes &&
                collaborationManager.isConnected() &&
                !collaborationManager.getIsLeader(),
            )
          if (recovered && committedEnv.value_type === 'secret') removeEnvSecret(committedEnv.id)
          return
        }

        const mutationIsCurrent = await commitPersistedEnvList(nextEnvList, patch)
        if (!mutationIsCurrent) {
          rollbackAffectedNodes?.()
          return
        }
        if (committedEnv.value_type === 'secret') removeEnvSecret(committedEnv.id)
      })
    },
    [
      enqueueSaveOperation,
      commitPersistedEnvList,
      emitVarsAndFeaturesUpdate,
      persistEnvListWithGraphChanges,
      persistQueuedEnvList,
      removeEnvSecret,
      reconcileAmbiguousPersistenceFailure,
      t,
      updateAffectedNodes,
      updateEnvList,
    ],
  )

  const deleteCheck = useCallback(
    (env: EnvironmentVariable) => {
      const affectedNodes = getAffectedNodes(env)
      if (affectedNodes.length > 0) {
        setCacheForDelete(env)
        setShowRemoveVarConfirm(true)
      } else {
        handleDelete(env)
      }
    },
    [getAffectedNodes, handleDelete],
  )

  const handleSave = useCallback(
    async (env: EnvironmentVariable) => {
      let newEnv = env
      if (!currentVar) {
        await enqueueSaveOperation(env.id, async () => {
          const nextEnvList = [
            env,
            ...committedEnvListRef.current.filter((item) => item.id !== env.id),
          ]
          const patch: EnvironmentVariablePatch = {
            environmentVariables: [env],
            deletedEnvironmentVariableIds: [],
          }
          const { persisted } = await persistQueuedEnvList(nextEnvList, patch)
          if (!persisted) {
            const recovered = await reconcileAmbiguousPersistenceFailure(patch)
            if (!recovered) toast.error(t(($) => $.error, { ns: 'common' }))
            if (recovered) {
              await emitVarsAndFeaturesUpdate()
              if (env.value_type === 'secret') saveSecretValue(env)
            }
            return
          }
          const mutationIsCurrent = await commitPersistedEnvList(nextEnvList, patch)
          if (!mutationIsCurrent) return
          if (env.value_type === 'secret') saveSecretValue(env)
        })
        return
      }

      let shouldSaveSecret = false
      let shouldRemoveSecret = false
      if (currentVar.value_type === 'secret') {
        if (env.value_type === 'secret') {
          if (workflowStore.getState().envSecrets[currentVar.id] !== env.value) {
            newEnv = env
            shouldSaveSecret = true
          } else {
            newEnv = sanitizeSecretValue(env)
          }
        } else {
          shouldRemoveSecret = true
        }
      } else if (env.value_type === 'secret') {
        shouldSaveSecret = true
      }

      await enqueueSaveOperation(currentVar.id, async () => {
        const committedEnv = committedEnvListRef.current.find((item) => item.id === currentVar.id)
        if (!committedEnv) return

        let applyLLMNodeReconciliation: (() => (() => void) | undefined) | undefined
        try {
          applyLLMNodeReconciliation = await prepareAffectedLLMNodeReconciliation(
            committedEnv,
            newEnv,
          )
        } catch {
          restoreCommittedEnvList()
          toast.error(t(($) => $.error, { ns: 'common' }))
          return
        }

        committedEnvListRef.current = mergeLatestUntouchedEnvList(committedEnvListRef.current)

        const nextCommittedEnvList = committedEnvListRef.current.map((item) =>
          item.id === currentVar.id ? newEnv : item,
        )
        updateEnvList(nextCommittedEnvList)
        const rollbackReconciledLLMNodes = applyLLMNodeReconciliation?.()
        const hasEnvNameChanged = committedEnv.name !== newEnv.name
        const rollbackRenamedAffectedNodes = hasEnvNameChanged
          ? updateAffectedNodes(committedEnv, ['env', newEnv.name])
          : undefined
        const hasGraphChanges = !!rollbackReconciledLLMNodes || !!rollbackRenamedAffectedNodes
        const patch: EnvironmentVariablePatch = {
          environmentVariables: [newEnv],
          deletedEnvironmentVariableIds: [],
        }
        const persisted = hasGraphChanges
          ? await persistEnvListWithGraphChanges(nextCommittedEnvList, patch)
          : (await persistQueuedEnvList(nextCommittedEnvList, patch)).persisted
        if (!persisted) {
          const recovered = await reconcileAmbiguousPersistenceFailure(patch)
          if (!recovered) {
            rollbackRenamedAffectedNodes?.()
            rollbackReconciledLLMNodes?.()
            toast.error(t(($) => $.error, { ns: 'common' }))
          }
          if (recovered)
            await emitVarsAndFeaturesUpdate(
              hasGraphChanges &&
                collaborationManager.isConnected() &&
                !collaborationManager.getIsLeader(),
            )
          if (recovered && shouldSaveSecret) saveSecretValue(newEnv)
          else if (recovered && shouldRemoveSecret) removeEnvSecret(currentVar.id)
          return
        }

        const mutationIsCurrent = await commitPersistedEnvList(nextCommittedEnvList, patch)
        if (!mutationIsCurrent) {
          rollbackRenamedAffectedNodes?.()
          rollbackReconciledLLMNodes?.()
          return
        }
        if (shouldSaveSecret) saveSecretValue(newEnv)
        else if (shouldRemoveSecret) removeEnvSecret(currentVar.id)
      })
    },
    [
      currentVar,
      commitPersistedEnvList,
      enqueueSaveOperation,
      emitVarsAndFeaturesUpdate,
      mergeLatestUntouchedEnvList,
      persistEnvListWithGraphChanges,
      persistQueuedEnvList,
      removeEnvSecret,
      prepareAffectedLLMNodeReconciliation,
      reconcileAmbiguousPersistenceFailure,
      saveSecretValue,
      restoreCommittedEnvList,
      t,
      updateAffectedNodes,
      updateEnvList,
      workflowStore,
    ],
  )

  const handleVariableModalClose = () => {
    setCurrentVar(undefined)
  }

  return (
    <div
      className={cn(
        'relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
      )}
    >
      <div className="flex shrink-0 items-center justify-between p-4 pb-0 system-xl-semibold text-text-primary">
        {t(($) => $['env.envPanelTitle'], { ns: 'workflow' })}
        <div className="flex items-center">
          <button
            type="button"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            className="flex size-6 cursor-pointer items-center justify-center"
            onClick={() => setShowEnvPanel(false)}
          >
            {/* oxlint-disable-next-line hyoban/prefer-tailwind-icons */}
            <RiCloseLine className="size-4 text-text-tertiary" />
          </button>
        </div>
      </div>
      <div className="shrink-0 px-4 py-1 system-sm-regular text-text-tertiary">
        {t(($) => $['env.envDescription'], { ns: 'workflow' })}
      </div>
      <div className="shrink-0 px-4 pt-2 pb-3">
        <VariableTrigger
          open={showVariableModal}
          setOpen={setShowVariableModal}
          env={currentVar}
          onSave={handleSave}
          onClose={handleVariableModalClose}
        />
      </div>
      <div className="grow overflow-y-auto rounded-b-2xl px-4">
        {envList.map((env) => (
          <EnvItem key={env.id} env={env} onEdit={handleEdit} onDelete={deleteCheck} />
        ))}
      </div>
      <RemoveEffectVarConfirm
        isShow={showRemoveVarConfirm}
        onCancel={() => setShowRemoveVarConfirm(false)}
        onConfirm={() => cacheForDelete && handleDelete(cacheForDelete)}
      />
    </div>
  )
}

export default memo(EnvPanel)
