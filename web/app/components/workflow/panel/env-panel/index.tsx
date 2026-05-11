import type {
  EnvironmentVariable,
} from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiCloseLine } from '@remixicon/react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
import { findUsedVarNodes, updateNodeVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import EnvItem from '@/app/components/workflow/panel/env-panel/env-item'
import VariableTrigger from '@/app/components/workflow/panel/env-panel/variable-trigger'
import { useStore } from '@/app/components/workflow/store'

const HIDDEN_SECRET_VALUE = '[__HIDDEN__]'

const formatSecret = (secret: string) => {
  return secret.length > 8 ? `${secret.slice(0, 6)}************${secret.slice(-2)}` : '********************'
}

const sanitizeSecretValue = (env: EnvironmentVariable) => {
  return env.value_type === 'secret'
    ? { ...env, value: HIDDEN_SECRET_VALUE }
    : env
}

const removeSecretFromMap = (secretMap: Record<string, string>, envId: string) => {
  const nextSecretMap = { ...secretMap }
  delete nextSecretMap[envId]
  return nextSecretMap
}

const useEnvPanelActions = ({
  collaborativeWorkflow,
  appId,
  envSecrets,
  updateEnvList,
  setEnvSecrets,
  setControlPromptEditorRerenderKey,
  doSyncWorkflowDraft,
}: {
  collaborativeWorkflow: ReturnType<typeof useCollaborativeWorkflow>
  appId: string
  envSecrets: Record<string, string>
  updateEnvList: (envList: EnvironmentVariable[]) => void
  setEnvSecrets: (envSecrets: Record<string, string>) => void
  setControlPromptEditorRerenderKey: (controlPromptEditorRerenderKey: number) => void
  doSyncWorkflowDraft: () => Promise<void>
}) => {
  const emitVarsAndFeaturesUpdate = useCallback(async () => {
    try {
      const { webSocketClient } = await import('@/app/components/workflow/collaboration/core/websocket-manager')
      const socket = webSocketClient.getSocket(appId)
      if (socket) {
        socket.emit('collaboration_event', {
          type: 'vars_and_features_update',
        })
      }
    }
    catch (error) {
      console.error('Failed to emit vars_and_features_update event:', error)
    }
  }, [appId])

  const persistEnvironmentVariables = useCallback(async (nextEnvList: EnvironmentVariable[]) => {
    try {
      const { updateEnvironmentVariables } = await import('@/service/workflow')
      await updateEnvironmentVariables({
        appId,
        environmentVariables: nextEnvList,
      })
      await emitVarsAndFeaturesUpdate()
      return true
    }
    catch (error) {
      console.error('Failed to update environment variables:', error)
      return false
    }
  }, [appId, emitVarsAndFeaturesUpdate])

  const getAffectedNodes = useCallback((env: EnvironmentVariable) => {
    const { nodes: allNodes } = collaborativeWorkflow.getState()
    return findUsedVarNodes(
      ['env', env.name],
      allNodes,
    )
  }, [collaborativeWorkflow])

  const updateAffectedNodes = useCallback((currentEnv: EnvironmentVariable, nextSelector: string[]) => {
    const { nodes, setNodes } = collaborativeWorkflow.getState()
    const affectedNodes = getAffectedNodes(currentEnv)
    const nextNodes = nodes.map((node) => {
      if (affectedNodes.find(affectedNode => affectedNode.id === node.id))
        return updateNodeVars(node, ['env', currentEnv.name], nextSelector)

      return node
    })
    setNodes(nextNodes)
    setControlPromptEditorRerenderKey(Date.now())
  }, [collaborativeWorkflow, getAffectedNodes, setControlPromptEditorRerenderKey])

  const syncEnvList = useCallback(async (
    nextEnvList: EnvironmentVariable[],
    options?: {
      syncDraft?: boolean
    },
  ) => {
    updateEnvList(nextEnvList)
    const shouldSyncDraft = options?.syncDraft ?? true

    let persisted = false
    if (shouldSyncDraft) {
      const syncDraftPromise = doSyncWorkflowDraft()
      persisted = await persistEnvironmentVariables(nextEnvList)
      await syncDraftPromise
    }
    else {
      persisted = await persistEnvironmentVariables(nextEnvList)
    }

    updateEnvList(nextEnvList.map(sanitizeSecretValue))
    return persisted
  }, [doSyncWorkflowDraft, persistEnvironmentVariables, updateEnvList])

  const saveSecretValue = useCallback((env: EnvironmentVariable) => {
    setEnvSecrets({
      ...envSecrets,
      [env.id]: formatSecret(String(env.value)),
    })
  }, [envSecrets, setEnvSecrets])

  const removeEnvSecret = useCallback((envId: string) => {
    setEnvSecrets(removeSecretFromMap(envSecrets, envId))
  }, [envSecrets, setEnvSecrets])

  return {
    getAffectedNodes,
    updateAffectedNodes,
    syncEnvList,
    saveSecretValue,
    removeEnvSecret,
  }
}

const EnvPanel = () => {
  const { t } = useTranslation()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const envList = useStore(s => s.environmentVariables) as EnvironmentVariable[]
  const envSecrets = useStore(s => s.envSecrets)
  const updateEnvList = useStore(s => s.setEnvironmentVariables)
  const setEnvSecrets = useStore(s => s.setEnvSecrets)
  const setControlPromptEditorRerenderKey = useStore(s => s.setControlPromptEditorRerenderKey)
  const appId = useStore(s => s.appId) as string
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    getAffectedNodes,
    updateAffectedNodes,
    syncEnvList,
    saveSecretValue,
    removeEnvSecret,
  } = useEnvPanelActions({
    collaborativeWorkflow,
    appId,
    envSecrets,
    updateEnvList,
    setEnvSecrets,
    setControlPromptEditorRerenderKey,
    doSyncWorkflowDraft,
  })

  const [showVariableModal, setShowVariableModal] = useState(false)
  const [currentVar, setCurrentVar] = useState<EnvironmentVariable>()

  const [showRemoveVarConfirm, setShowRemoveVarConfirm] = useState(false)
  const [cacheForDelete, setCacheForDelete] = useState<EnvironmentVariable>()

  const handleEdit = (env: EnvironmentVariable) => {
    setCurrentVar(env)
    setShowVariableModal(true)
  }

  const handleDelete = useCallback(async (env: EnvironmentVariable) => {
    const nextEnvList = envList.filter(e => e.id !== env.id)
    setCacheForDelete(undefined)
    setShowRemoveVarConfirm(false)
    updateAffectedNodes(env, [])
    if (env.value_type === 'secret')
      removeEnvSecret(env.id)
    await syncEnvList(nextEnvList)
  }, [envList, removeEnvSecret, syncEnvList, updateAffectedNodes])

  const deleteCheck = useCallback((env: EnvironmentVariable) => {
    const affectedNodes = getAffectedNodes(env)
    if (affectedNodes.length > 0) {
      setCacheForDelete(env)
      setShowRemoveVarConfirm(true)
    }
    else {
      handleDelete(env)
    }
  }, [getAffectedNodes, handleDelete])

  const handleSave = useCallback(async (env: EnvironmentVariable) => {
    let newEnv = env
    if (!currentVar) {
      if (env.value_type === 'secret')
        saveSecretValue(env)
      await syncEnvList([env, ...envList])
      return
    }

    if (currentVar.value_type === 'secret') {
      if (env.value_type === 'secret') {
        if (envSecrets[currentVar.id] !== env.value) {
          newEnv = env
          saveSecretValue(env)
        }
        else {
          newEnv = sanitizeSecretValue(env)
        }
      }
      else {
        removeEnvSecret(currentVar.id)
      }
    }
    else if (env.value_type === 'secret') {
      saveSecretValue(env)
    }

    const nextEnvList = envList.map(e => e.id === currentVar.id ? newEnv : e)
    const hasEnvNameChanged = currentVar.name !== env.name
    if (hasEnvNameChanged)
      updateAffectedNodes(currentVar, ['env', env.name])

    const persisted = await syncEnvList(nextEnvList, { syncDraft: hasEnvNameChanged })
    if (!persisted && !hasEnvNameChanged)
      await doSyncWorkflowDraft()
  }, [currentVar, doSyncWorkflowDraft, envList, envSecrets, removeEnvSecret, saveSecretValue, syncEnvList, updateAffectedNodes])

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
        {t('env.envPanelTitle', { ns: 'workflow' })}
        <div className="flex items-center">
          <div
            className="flex h-6 w-6 cursor-pointer items-center justify-center"
            onClick={() => setShowEnvPanel(false)}
          >
            {/* eslint-disable-next-line hyoban/prefer-tailwind-icons */}
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      </div>
      <div className="shrink-0 px-4 py-1 system-sm-regular text-text-tertiary">{t('env.envDescription', { ns: 'workflow' })}</div>
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
        {envList.map(env => (
          <EnvItem
            key={env.id}
            env={env}
            onEdit={handleEdit}
            onDelete={deleteCheck}
          />
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
