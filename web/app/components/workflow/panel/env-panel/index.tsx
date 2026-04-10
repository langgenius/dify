import type {
  EnvironmentVariable,
} from '@/app/components/workflow/types'
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
import { cn } from '@/utils/classnames'

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

const EnvPanel = () => {
  const { t } = useTranslation()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const envList = useStore(s => s.environmentVariables) as EnvironmentVariable[]
  const envSecrets = useStore(s => s.envSecrets)
  const updateEnvList = useStore(s => s.setEnvironmentVariables)
  const setEnvSecrets = useStore(s => s.setEnvSecrets)
  const appId = useStore(s => s.appId) as string
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

  const [showVariableModal, setShowVariableModal] = useState(false)
  const [currentVar, setCurrentVar] = useState<EnvironmentVariable>()

  const [showRemoveVarConfirm, setShowRemoveVarConfirm] = useState(false)
  const [cacheForDelete, setCacheForDelete] = useState<EnvironmentVariable>()

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

  const getAffectedNodes = useCallback((env: EnvironmentVariable) => {
    const { nodes: allNodes } = collaborativeWorkflow.getState()
    return findUsedVarNodes(
      ['env', env.name],
      allNodes,
    )
  }, [collaborativeWorkflow])

  const removeUsedVarInNodes = useCallback((env: EnvironmentVariable) => {
    const { nodes, setNodes } = collaborativeWorkflow.getState()
    const affectedNodes = getAffectedNodes(env)
    const newNodes = nodes.map((node) => {
      if (affectedNodes.find(n => n.id === node.id))
        return updateNodeVars(node, ['env', env.name], [])

      return node
    })
    setNodes(newNodes)
  }, [collaborativeWorkflow, getAffectedNodes])

  const renameUsedVarInNodes = useCallback((currentEnv: EnvironmentVariable, nextEnvName: string) => {
    const { nodes, setNodes } = collaborativeWorkflow.getState()
    const affectedNodes = getAffectedNodes(currentEnv)
    const newNodes = nodes.map((node) => {
      if (affectedNodes.find(n => n.id === node.id))
        return updateNodeVars(node, ['env', currentEnv.name], ['env', nextEnvName])

      return node
    })
    setNodes(newNodes)
  }, [collaborativeWorkflow, getAffectedNodes])

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

  const handleEdit = (env: EnvironmentVariable) => {
    setCurrentVar(env)
    setShowVariableModal(true)
  }

  const handleDelete = useCallback(async (env: EnvironmentVariable) => {
    const nextEnvList = envList.filter(e => e.id !== env.id)
    const nextEnvSecrets = env.value_type === 'secret'
      ? removeSecretFromMap(envSecrets, env.id)
      : envSecrets

    updateEnvList(nextEnvList)
    setEnvSecrets(nextEnvSecrets)
    setCacheForDelete(undefined)
    setShowRemoveVarConfirm(false)
    removeUsedVarInNodes(env)
    const syncDraftPromise = doSyncWorkflowDraft()
    await persistEnvironmentVariables(nextEnvList)
    await syncDraftPromise

    updateEnvList(nextEnvList.map(sanitizeSecretValue))
  }, [doSyncWorkflowDraft, envList, envSecrets, persistEnvironmentVariables, removeUsedVarInNodes, setEnvSecrets, updateEnvList])

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
    let nextEnvSecrets = { ...envSecrets }

    if (!currentVar) {
      if (env.value_type === 'secret')
        nextEnvSecrets[env.id] = formatSecret(String(env.value))

      const nextEnvList = [env, ...envList]
      updateEnvList(nextEnvList)
      setEnvSecrets(nextEnvSecrets)
      const syncDraftPromise = doSyncWorkflowDraft()
      await persistEnvironmentVariables(nextEnvList)
      await syncDraftPromise

      updateEnvList(nextEnvList.map(sanitizeSecretValue))
      return
    }

    if (currentVar.value_type === 'secret') {
      if (env.value_type === 'secret') {
        if (envSecrets[currentVar.id] !== env.value) {
          newEnv = env
          nextEnvSecrets[env.id] = formatSecret(String(env.value))
        }
        else {
          newEnv = sanitizeSecretValue(env)
        }
      }
      else {
        nextEnvSecrets = removeSecretFromMap(nextEnvSecrets, currentVar.id)
      }
    }
    else if (env.value_type === 'secret') {
      nextEnvSecrets[env.id] = formatSecret(String(env.value))
    }

    const nextEnvList = envList.map(e => e.id === currentVar.id ? newEnv : e)
    updateEnvList(nextEnvList)
    setEnvSecrets(nextEnvSecrets)

    const hasEnvNameChanged = currentVar.name !== env.name
    if (hasEnvNameChanged)
      renameUsedVarInNodes(currentVar, env.name)

    const persisted = await persistEnvironmentVariables(nextEnvList)
    if (!persisted || hasEnvNameChanged)
      await doSyncWorkflowDraft()

    updateEnvList(nextEnvList.map(sanitizeSecretValue))
  }, [currentVar, doSyncWorkflowDraft, envList, envSecrets, persistEnvironmentVariables, renameUsedVarInNodes, setEnvSecrets, updateEnvList])

  const handleVariableModalClose = () => {
    setCurrentVar(undefined)
  }

  return (
    <div
      className={cn(
        'relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
      )}
    >
      <div className="system-xl-semibold flex shrink-0 items-center justify-between p-4 pb-0 text-text-primary">
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
      <div className="system-sm-regular shrink-0 px-4 py-1 text-text-tertiary">{t('env.envDescription', { ns: 'workflow' })}</div>
      <div className="shrink-0 px-4 pb-3 pt-2">
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
