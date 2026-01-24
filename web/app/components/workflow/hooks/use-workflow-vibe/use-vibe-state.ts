import type { FlowGraph } from '../../store/workflow/vibe-workflow-slice'
import type { Model } from '@/types/app'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelModeType } from '@/types/app'
import { useHooksStore } from '../../hooks-store'
import { useStore, useWorkflowStore } from '../../store'

// Sync vibe flow data to sessionStorage
const STORAGE_KEY_PREFIX = 'vibe-flow-'

const loadFromSessionStorage = (flowId: string): { versions: FlowGraph[], currentIndex: number } | null => {
  if (typeof window === 'undefined')
    return null

  try {
    const versionsKey = `${STORAGE_KEY_PREFIX}${flowId}-versions`
    const indexKey = `${STORAGE_KEY_PREFIX}${flowId}-version-index`

    const versionsRaw = sessionStorage.getItem(versionsKey)
    const indexRaw = sessionStorage.getItem(indexKey)

    if (!versionsRaw)
      return null

    const versions = JSON.parse(versionsRaw) as FlowGraph[]
    const currentIndex = indexRaw ? Number.parseInt(indexRaw, 10) : 0

    return { versions, currentIndex }
  }
  catch {
    return null
  }
}

const saveToSessionStorage = (flowId: string, versions: FlowGraph[], currentIndex: number) => {
  if (typeof window === 'undefined')
    return

  try {
    const versionsKey = `${STORAGE_KEY_PREFIX}${flowId}-versions`
    const indexKey = `${STORAGE_KEY_PREFIX}${flowId}-version-index`

    sessionStorage.setItem(versionsKey, JSON.stringify(versions))
    sessionStorage.setItem(indexKey, String(currentIndex))
  }
  catch (error) {
    console.error('Failed to save vibe flow to sessionStorage:', error)
  }
}

export const useVibeFlowSessionStorage = (flowId: string) => {
  const workflowStore = useWorkflowStore()
  const versions = useStore(s => s.vibeFlowVersions)
  const currentIndex = useStore(s => s.vibeFlowCurrentIndex)
  const loadedFlowIdRef = useRef<string | null>(null)
  const isLoadingRef = useRef(false)

  // Load from sessionStorage when flowId changes
  useEffect(() => {
    if (!flowId || loadedFlowIdRef.current === flowId)
      return

    isLoadingRef.current = true
    const stored = loadFromSessionStorage(flowId)

    if (stored) {
      workflowStore.setState({
        vibeFlowVersions: stored.versions,
        vibeFlowCurrentIndex: stored.currentIndex,
      })
    }
    else {
      workflowStore.setState({
        vibeFlowVersions: [],
        vibeFlowCurrentIndex: 0,
        currentVibeFlow: undefined,
      })
    }

    loadedFlowIdRef.current = flowId
    // Delay to prevent immediate save
    const timer = setTimeout(() => {
      isLoadingRef.current = false
    }, 100)
    return () => clearTimeout(timer)
  }, [flowId, workflowStore])

  // Save to sessionStorage when versions or index change
  useEffect(() => {
    if (!flowId || loadedFlowIdRef.current !== flowId || isLoadingRef.current)
      return

    saveToSessionStorage(flowId, versions, currentIndex)
  }, [flowId, versions, currentIndex])
}

export const useVibeState = () => {
  const configsMap = useHooksStore(s => s.configsMap)
  const { defaultModel, modelList } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)
  const [modelConfig, setModelConfig] = useState<Model | null>(null)

  useVibeFlowSessionStorage(configsMap?.flowId || '')

  useEffect(() => {
    const storedModel = (() => {
      if (typeof window === 'undefined')
        return null
      const stored = localStorage.getItem('auto-gen-model')
      if (!stored)
        return null
      try {
        return JSON.parse(stored) as Model
      }
      catch {
        return null
      }
    })()

    if (storedModel) {
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setModelConfig(storedModel)
      return
    }

    if (defaultModel) {
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setModelConfig({
        name: defaultModel.model,
        provider: defaultModel.provider.provider,
        mode: ModelModeType.chat,
        completion_params: {} as Model['completion_params'],
      })
    }
  }, [defaultModel])

  const getLatestModelConfig = useCallback(() => {
    if (typeof window === 'undefined')
      return modelConfig
    const stored = localStorage.getItem('auto-gen-model')
    if (!stored)
      return modelConfig
    try {
      return JSON.parse(stored) as Model
    }
    catch {
      return modelConfig
    }
  }, [modelConfig])

  return {
    modelConfig,
    setModelConfig,
    getLatestModelConfig,
    modelList,
    defaultModel,
  }
}
