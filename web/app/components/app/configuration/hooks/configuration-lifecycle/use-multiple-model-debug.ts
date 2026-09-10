import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelConfig } from '@/models/debug'
import { useCallback } from 'react'
import { useDebugWithSingleOrMultipleModel } from '@/app/components/app/configuration/debug/hooks'
import { useSetDetailSidebarMode } from '@/app/components/detail-sidebar/storage'

export function useMultipleModelDebug({
  appId,
  completionParams,
  modelConfig,
}: {
  appId: string
  completionParams: FormValue
  modelConfig: ModelConfig
}) {
  const setDetailSidebarMode = useSetDetailSidebarMode()
  const { debugWithMultipleModel, multipleModelConfigs, handleMultipleModelConfigsChange } =
    useDebugWithSingleOrMultipleModel(appId)
  const enableMultipleModelDebug = useCallback(() => {
    handleMultipleModelConfigsChange(true, [
      {
        id: `${Date.now()}`,
        model: modelConfig.model_id,
        provider: modelConfig.provider,
        parameters: completionParams,
      },
      { id: `${Date.now()}-no-repeat`, model: '', provider: '', parameters: {} },
    ])
    setDetailSidebarMode('collapse')
  }, [
    completionParams,
    handleMultipleModelConfigsChange,
    modelConfig.model_id,
    modelConfig.provider,
    setDetailSidebarMode,
  ])

  return {
    debugWithMultipleModel,
    enableMultipleModelDebug,
    handleMultipleModelConfigsChange,
    multipleModelConfigs,
  }
}
