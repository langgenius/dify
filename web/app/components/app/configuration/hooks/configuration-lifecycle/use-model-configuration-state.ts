import type { ConfigurationPublishConfig } from './types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { VisionSettings } from '@/types/app'
import { useGetState } from 'ahooks'
import { useCallback, useRef, useState } from 'react'
import { ModelModeType, Resolution, TransferMethod } from '@/types/app'

export function useModelConfigurationState({
  formattingChangedDispatcher,
  initialConfig,
}: {
  initialConfig: ConfigurationPublishConfig
  formattingChangedDispatcher: () => void
}) {
  const [completionParams, setCompletionParams] = useState<FormValue>(
    initialConfig.completionParams,
  )
  // oxlint-disable-next-line eslint-react/use-state -- useGetState returns value, setter, and getter.
  const tempStopState = useGetState<string[]>([])
  const setTempStop = tempStopState[1]
  const getTempStop = tempStopState[2]
  const [modelConfig, setModelConfig] = useState(initialConfig.modelConfig)
  const modelModeTypeRef = useRef(modelConfig.mode)
  const [visionConfig, setVisionConfig] = useState({
    enabled: initialConfig.modelConfig.file_upload?.image?.enabled ?? false,
    number_limits: initialConfig.modelConfig.file_upload?.image?.number_limits ?? 2,
    detail: initialConfig.modelConfig.file_upload?.image?.detail ?? Resolution.low,
    transfer_methods: initialConfig.modelConfig.file_upload?.image?.transfer_methods ?? [
      TransferMethod.local_file,
    ],
  })

  const updateCompletionParams = useCallback(
    (value: FormValue) => {
      const params = { ...value }
      if (
        (!params.stop || params.stop.length === 0) &&
        modelModeTypeRef.current === ModelModeType.completion
      ) {
        params.stop = getTempStop()
        setTempStop([])
      }
      setCompletionParams(params)
    },
    [getTempStop, setTempStop],
  )

  const updateVisionConfig = useCallback(
    (config: VisionSettings, notNoticeFormattingChanged?: boolean) => {
      setVisionConfig({
        enabled: config.enabled || false,
        number_limits: config.number_limits || 2,
        detail: config.detail || Resolution.low,
        transfer_methods: config.transfer_methods || [TransferMethod.local_file],
      })
      if (!notNoticeFormattingChanged) formattingChangedDispatcher()
    },
    [formattingChangedDispatcher],
  )

  return {
    completionParams,
    modelConfig,
    modelModeTypeRef,
    setCompletionParams: updateCompletionParams,
    setModelConfig,
    setTempStop,
    setVisionConfig: updateVisionConfig,
    visionConfig,
  }
}
