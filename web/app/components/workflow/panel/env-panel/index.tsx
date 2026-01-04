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
import {
  useStoreApi,
} from 'reactflow'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import RemoveEffectVarConfirm from '@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm'
import { findUsedVarNodes, updateNodeVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import EnvItem from '@/app/components/workflow/panel/env-panel/env-item'
import VariableTrigger from '@/app/components/workflow/panel/env-panel/variable-trigger'
import { useStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'

const EnvPanel = () => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const envList = useStore(s => s.environmentVariables) as EnvironmentVariable[]
  const envSecrets = useStore(s => s.envSecrets)
  const updateEnvList = useStore(s => s.setEnvironmentVariables)
  const setEnvSecrets = useStore(s => s.setEnvSecrets)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()

  const [showVariableModal, setShowVariableModal] = useState(false)
  const [currentVar, setCurrentVar] = useState<EnvironmentVariable>()

  const [showRemoveVarConfirm, setShowRemoveConfirm] = useState(false)
  const [cacheForDelete, setCacheForDelete] = useState<EnvironmentVariable>()

  const formatSecret = (s: string) => {
    return s.length > 8 ? `${s.slice(0, 6)}************${s.slice(-2)}` : '********************'
  }

  const getEffectedNodes = useCallback((env: EnvironmentVariable) => {
    const { getNodes } = store.getState()
    const allNodes = getNodes()
    return findUsedVarNodes(
      ['env', env.name],
      allNodes,
    )
  }, [store])

  const removeUsedVarInNodes = useCallback((env: EnvironmentVariable) => {
    const { getNodes, setNodes } = store.getState()
    const effectedNodes = getEffectedNodes(env)
    const newNodes = getNodes().map((node) => {
      if (effectedNodes.find(n => n.id === node.id))
        return updateNodeVars(node, ['env', env.name], [])

      return node
    })
    setNodes(newNodes)
  }, [getEffectedNodes, store])

  const handleEdit = (env: EnvironmentVariable) => {
    setCurrentVar(env)
    setShowVariableModal(true)
  }

  const handleDelete = useCallback((env: EnvironmentVariable) => {
    removeUsedVarInNodes(env)
    updateEnvList(envList.filter(e => e.id !== env.id))
    setCacheForDelete(undefined)
    setShowRemoveConfirm(false)
    doSyncWorkflowDraft()
    if (env.value_type === 'secret') {
      const newMap = { ...envSecrets }
      delete newMap[env.id]
      setEnvSecrets(newMap)
    }
  }, [doSyncWorkflowDraft, envList, envSecrets, removeUsedVarInNodes, setEnvSecrets, updateEnvList])

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
    if (!currentVar) {
      if (env.value_type === 'secret') {
        setEnvSecrets({
          ...envSecrets,
          [env.id]: formatSecret(env.value),
        })
      }
      const newList = [env, ...envList]
      updateEnvList(newList)
      await doSyncWorkflowDraft()
      updateEnvList(newList.map(e => (e.id === env.id && env.value_type === 'secret') ? { ...e, value: '[__HIDDEN__]' } : e))
      return
    }
    else if (currentVar.value_type === 'secret') {
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
    const newList = envList.map(e => e.id === currentVar.id ? newEnv : e)
    updateEnvList(newList)
    // side effects of rename env
    if (currentVar.name !== env.name) {
      const { getNodes, setNodes } = store.getState()
      const effectedNodes = getEffectedNodes(currentVar)
      const newNodes = getNodes().map((node) => {
        if (effectedNodes.find(n => n.id === node.id))
          return updateNodeVars(node, ['env', currentVar.name], ['env', env.name])

        return node
      })
      setNodes(newNodes)
    }
    await doSyncWorkflowDraft()
    updateEnvList(newList.map(e => (e.id === env.id && env.value_type === 'secret') ? { ...e, value: '[__HIDDEN__]' } : e))
  }, [currentVar, doSyncWorkflowDraft, envList, envSecrets, getEffectedNodes, setEnvSecrets, store, updateEnvList])

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
          onClose={() => setCurrentVar(undefined)}
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
        onCancel={() => setShowRemoveConfirm(false)}
        onConfirm={() => cacheForDelete && handleDelete(cacheForDelete)}
      />
    </div>
  )
}

export default memo(EnvPanel)
