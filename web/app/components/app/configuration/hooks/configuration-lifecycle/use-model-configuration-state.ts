import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelConfig } from '@/models/debug'
import type { VisionSettings } from '@/types/app'
import { useGetState } from 'ahooks'
import { clone } from 'es-toolkit/object'
import { useCallback, useRef, useState } from 'react'
import {
  DEFAULT_AGENT_SETTING,
  DEFAULT_CHAT_PROMPT_CONFIG,
  DEFAULT_COMPLETION_PROMPT_CONFIG,
} from '@/config'
import { ModelModeType, Resolution, TransferMethod } from '@/types/app'

function createInitialModelConfig(): ModelConfig {
  return {
    provider: 'langgenius/openai/openai',
    model_id: 'gpt-3.5-turbo',
    mode: ModelModeType.unset,
    configs: {
      prompt_template: '',
      prompt_variables: [],
    },
    chat_prompt_config: clone(DEFAULT_CHAT_PROMPT_CONFIG),
    completion_prompt_config: clone(DEFAULT_COMPLETION_PROMPT_CONFIG),
    more_like_this: null,
    opening_statement: '',
    suggested_questions: [],
    sensitive_word_avoidance: null,
    speech_to_text: null,
    text_to_speech: null,
    file_upload: null,
    suggested_questions_after_answer: null,
    retriever_resource: null,
    annotation_reply: null,
    external_data_tools: [],
    system_parameters: {
      audio_file_size_limit: 0,
      file_size_limit: 0,
      image_file_size_limit: 0,
      video_file_size_limit: 0,
      workflow_file_upload_limit: 0,
    },
    dataSets: [],
    agentConfig: DEFAULT_AGENT_SETTING,
  }
}

export function useModelConfigurationState({
  formattingChangedDispatcher,
}: {
  formattingChangedDispatcher: () => void
}) {
  const [completionParams, setCompletionParams] = useState<FormValue>({})
  // oxlint-disable-next-line eslint-react/use-state -- useGetState returns value, setter, and getter.
  const tempStopState = useGetState<string[]>([])
  const setTempStop = tempStopState[1]
  const getTempStop = tempStopState[2]
  const [modelConfig, setModelConfig] = useState(createInitialModelConfig)
  const modelModeTypeRef = useRef(modelConfig.mode)
  const [visionConfig, setVisionConfig] = useState({
    enabled: false,
    number_limits: 2,
    detail: Resolution.low,
    transfer_methods: [TransferMethod.local_file],
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
