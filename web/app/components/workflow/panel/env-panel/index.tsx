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

const HIDDEN_SECRET_VALUE = '[__HIDDEN__]'

const formatSecret = (secret: string) => {
  return secret.length > 8 ? `${secret.slice(0, 6)}************${secret.slice(-2)}` : '********************'
}

const sanitizeSecretValue = (env: EnvironmentVariable) => {
  return env.value_type === 'secret'
    ? { ...env, value: HIDDEN_SECRET_VALUE }
    : env
}

const useEnvPanelActions = ({
  store,
  envSecrets,
  updateEnvList,
  setEnvSecrets,
  doSyncWorkflowDraft,
}: {
  store: ReturnType<typeof useStoreApi>
  envSecrets: Record<string, string>
  updateEnvList: (envList: EnvironmentVariable[]) => void
  setEnvSecrets: (envSecrets: Record<string, string>) => void
  doSyncWorkflowDraft: () => Promise<void>
}) => {
  const getAffectedNodes = useCallback((env: EnvironmentVariable) => {
    const allNodes = store.getState().getNodes()
    return findUsedVarNodes(
      ['env', env.name],
      allNodes,
    )
  }, [store])

  const updateAffectedNodes = useCallback((currentEnv: EnvironmentVariable, nextSelector: string[]) => {
    const { getNodes, setNodes } = store.getState()
    const affectedNodes = getAffectedNodes(currentEnv)
    const nextNodes = getNodes().map((node) => {
      if (affectedNodes.find(affectedNode => affectedNode.id === node.id))
        return updateNodeVars(node, ['env', currentEnv.name], nextSelector)

      return node
    })
    setNodes(nextNodes)
  }, [getAffectedNodes, store])

  const syncEnvList = useCallback(async (nextEnvList: EnvironmentVariable[]) => {
    updateEnvList(nextEnvList)
    await doSyncWorkflowDraft()
    updateEnvList(nextEnvList.map(sanitizeSecretValue))
  }, [doSyncWorkflowDraft, updateEnvList])

  const saveSecretValue = useCallback((env: EnvironmentVariable) => {
    setEnvSecrets({
      ...envSecrets,
      [env.id]: formatSecret(String(env.value)),
    })
  }, [envSecrets, setEnvSecrets])

  const removeEnvSecret = useCallback((envId: string) => {
    const nextSecrets = { ...envSecrets }
    delete nextSecrets[envId]
    setEnvSecrets(nextSecrets)
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
  const store = useStoreApi()
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const envList = useStore(s => s.environmentVariables) as EnvironmentVariable[]
  const envSecrets = useStore(s => s.envSecrets)
  const updateEnvList = useStore(s => s.setEnvironmentVariables)
  const setEnvSecrets = useStore(s => s.setEnvSecrets)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    getAffectedNodes,
    updateAffectedNodes,
    syncEnvList,
    saveSecretValue,
    removeEnvSecret,
  } = useEnvPanelActions({
    store,
    envSecrets,
    updateEnvList,
    setEnvSecrets,
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

  const handleDelete = useCallback((env: EnvironmentVariable) => {
    updateAffectedNodes(env, [])
    updateEnvList(envList.filter(e => e.id !== env.id))
    setCacheForDelete(undefined)
    setShowRemoveVarConfirm(false)
    doSyncWorkflowDraft()
    if (env.value_type === 'secret')
      removeEnvSecret(env.id)
  }, [doSyncWorkflowDraft, envList, removeEnvSecret, updateAffectedNodes, updateEnvList])

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
    }
    else if (env.value_type === 'secret') {
      saveSecretValue(env)
    }

    const newList = envList.map(e => e.id === currentVar.id ? newEnv : e)
    if (currentVar.name !== env.name)
      updateAffectedNodes(currentVar, ['env', env.name])

    await syncEnvList(newList)
  }, [currentVar, envList, envSecrets, saveSecretValue, syncEnvList, updateAffectedNodes])

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
