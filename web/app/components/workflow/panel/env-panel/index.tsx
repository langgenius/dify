import {
  memo,
  useCallback,
  useState,
} from 'react'
import { RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import VariableTrigger from '@/app/components/workflow/panel/env-panel/variable-trigger'
import EnvItem from '@/app/components/workflow/panel/env-panel/env-item'
import type {
  EnvironmentVariable,
} from '@/app/components/workflow/types'
import { findUsedVarNodes, updateNodeVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
import cn from '@/utils/classnames'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { updateEnvironmentVariables } from '@/service/workflow'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'

const EnvPanel = () => {
  const { t } = useTranslation()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const envList = useStore(s => s.environmentVariables) as EnvironmentVariable[]
  const envSecrets = useStore(s => s.envSecrets)
  const updateEnvList = useStore(s => s.setEnvironmentVariables)
  const setEnvSecrets = useStore(s => s.setEnvSecrets)
  const appId = useWorkflowStore(s => s.appId) as string

  const [showVariableModal, setShowVariableModal] = useState(false)
  const [currentVar, setCurrentVar] = useState<EnvironmentVariable>()

  const [showRemoveVarConfirm, setShowRemoveConfirm] = useState(false)
  const [cacheForDelete, setCacheForDelete] = useState<EnvironmentVariable>()

  const formatSecret = (s: string) => {
    return s.length > 8 ? `${s.slice(0, 6)}************${s.slice(-2)}` : '********************'
  }

  const getEffectedNodes = useCallback((env: EnvironmentVariable) => {
    const { nodes: allNodes } = collaborativeWorkflow.getState()
    return findUsedVarNodes(
      ['env', env.name],
      allNodes,
    )
  }, [collaborativeWorkflow])

  const removeUsedVarInNodes = useCallback((env: EnvironmentVariable) => {
    const { nodes, setNodes } = collaborativeWorkflow.getState()
    const effectedNodes = getEffectedNodes(env)
    const newNodes = nodes.map((node) => {
      if (effectedNodes.find(n => n.id === node.id))
        return updateNodeVars(node, ['env', env.name], [])

      return node
    })
    setNodes(newNodes)
  }, [getEffectedNodes, collaborativeWorkflow])

  const handleEdit = (env: EnvironmentVariable) => {
    setCurrentVar(env)
    setShowVariableModal(true)
  }

  const handleDelete = useCallback(async (env: EnvironmentVariable) => {
    removeUsedVarInNodes(env)
    const newEnvList = envList.filter(e => e.id !== env.id)
    updateEnvList(newEnvList)
    setCacheForDelete(undefined)
    setShowRemoveConfirm(false)

    // Use new dedicated environment variables API instead of workflow draft sync
    try {
      await updateEnvironmentVariables({
        appId,
        environmentVariables: newEnvList,
      })

      // Emit update event to other connected clients
      const socket = webSocketClient.getSocket(appId)
      if (socket?.connected) {
        socket.emit('collaboration_event', {
          type: 'vars_and_features_update',
          timestamp: Date.now(),
        })
      }
    }
    catch (error) {
      console.error('Failed to update environment variables:', error)
      // Revert local state on error
      updateEnvList(envList)
    }

    if (env.value_type === 'secret') {
      const newMap = { ...envSecrets }
      delete newMap[env.id]
      setEnvSecrets(newMap)
    }
  }, [envList, envSecrets, removeUsedVarInNodes, setEnvSecrets, updateEnvList, appId])

  const deleteCheck = useCallback((env: EnvironmentVariable) => {
    const effectedNodes = getEffectedNodes(env)
    if (effectedNodes.length > 0) {
      setCacheForDelete(env)
      setShowRemoveConfirm(true)
    }
    else {
      handleDelete(env)
    }
  }, [getEffectedNodes, handleDelete])

  const handleSave = useCallback(async (env: EnvironmentVariable) => {
    // add env
    let newEnv = env
    let newList: EnvironmentVariable[]

    if (!currentVar) {
      // Adding new environment variable
      if (env.value_type === 'secret') {
        setEnvSecrets({
          ...envSecrets,
          [env.id]: formatSecret(env.value),
        })
      }
      newList = [env, ...envList]
      updateEnvList(newList)

      // Use new dedicated environment variables API
      try {
        await updateEnvironmentVariables({
          appId,
          environmentVariables: newList,
        })

        const socket = webSocketClient.getSocket(appId)
        if (socket) {
          socket.emit('collaboration_event', {
            type: 'vars_and_features_update',
          })
        }

        // Hide secret values in UI
        updateEnvList(newList.map(e => (e.id === env.id && env.value_type === 'secret') ? { ...e, value: '[__HIDDEN__]' } : e))
      }
      catch (error) {
        console.error('Failed to update environment variables:', error)
        // Revert local state on error
        updateEnvList(envList)
      }
      return
    }

    // Updating existing environment variable
    if (currentVar.value_type === 'secret') {
      if (env.value_type === 'secret') {
        if (envSecrets[currentVar.id] !== env.value) {
          newEnv = env
          setEnvSecrets({
            ...envSecrets,
            [env.id]: formatSecret(env.value),
          })
        }
        else {
          newEnv = { ...env, value: '[__HIDDEN__]' }
        }
      }
    }
    else {
      if (env.value_type === 'secret') {
        newEnv = env
        setEnvSecrets({
          ...envSecrets,
          [env.id]: formatSecret(env.value),
        })
      }
    }

    newList = envList.map(e => e.id === currentVar.id ? newEnv : e)
    updateEnvList(newList)

    // side effects of rename env
    if (currentVar.name !== env.name) {
      const { nodes, setNodes } = collaborativeWorkflow.getState()
      const effectedNodes = getEffectedNodes(currentVar)
      const newNodes = nodes.map((node) => {
        if (effectedNodes.find(n => n.id === node.id))
          return updateNodeVars(node, ['env', currentVar.name], ['env', env.name])

        return node
      })
      setNodes(newNodes)
    }

    // Use new dedicated environment variables API
    try {
      await updateEnvironmentVariables({
        appId,
        environmentVariables: newList,
      })

      const socket = webSocketClient.getSocket(appId)
      if (socket) {
        socket.emit('collaboration_event', {
          type: 'vars_and_features_update',
        })
      }

      // Hide secret values in UI
      updateEnvList(newList.map(e => (e.id === env.id && env.value_type === 'secret') ? { ...e, value: '[__HIDDEN__]' } : e))
    }
    catch (error) {
      console.error('Failed to update environment variables:', error)
      // Revert local state on error
      updateEnvList(envList)
    }
  }, [currentVar, envList, envSecrets, getEffectedNodes, setEnvSecrets, collaborativeWorkflow, updateEnvList, appId])

  return (
    <div
      className={cn(
        'relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
      )}
    >
      <div className='system-xl-semibold flex shrink-0 items-center justify-between p-4 pb-0 text-text-primary'>
        {t('workflow.env.envPanelTitle')}
        <div className='flex items-center'>
          <div
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
            onClick={() => setShowEnvPanel(false)}
          >
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='system-sm-regular shrink-0 px-4 py-1 text-text-tertiary'>{t('workflow.env.envDescription')}</div>
      <div className='shrink-0 px-4 pb-3 pt-2'>
        <VariableTrigger
          open={showVariableModal}
          setOpen={setShowVariableModal}
          env={currentVar}
          onSave={handleSave}
          onClose={() => setCurrentVar(undefined)}
        />
      </div>
      <div className='grow overflow-y-auto rounded-b-2xl px-4'>
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
        onCancel={() => setShowRemoveConfirm(false)}
        onConfirm={() => cacheForDelete && handleDelete(cacheForDelete)}
      />
    </div>
  )
}

export default memo(EnvPanel)
