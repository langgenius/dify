'use client'
import type { FC } from 'react'
import type { DebugWithSingleModelRefType } from './debug-with-single-model'
import type { ModelAndParameter } from './types'
import type { ModelParameterModalProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import type { Inputs, PromptVariable } from '@/models/debug'
import type { VisionFile, VisionSettings } from '@/types/app'
import { produce, setAutoFreeze } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useShallow } from 'zustand/react/shallow'
import ChatUserInput from '@/app/components/app/configuration/debug/chat-user-input'
import PromptValuePanel from '@/app/components/app/configuration/prompt-value-panel'
import { useStore as useAppStore } from '@/app/components/app/store'
import AgentLogModal from '@/app/components/base/agent-log-modal'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import PromptLogModal from '@/app/components/base/prompt-log-modal'
import { ModelFeatureEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { IS_CE_EDITION } from '@/config'
import ConfigContext from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'
import { AppModeEnum } from '@/types/app'
import CannotQueryDataset from '../base/warning-mask/cannot-query-dataset'
import FormattingChanged from '../base/warning-mask/formatting-changed'
import HasNotSetAPIKEY from '../base/warning-mask/has-not-set-api'
import DebugHeader from './debug-header'
import DebugWithMultipleModel from './debug-with-multiple-model'
import DebugWithSingleModel from './debug-with-single-model'
import { useFormattingChangeConfirm, useInputValidation, useModalWidth } from './hooks'
import TextCompletionResult from './text-completion-result'
import {
  APP_CHAT_WITH_MULTIPLE_MODEL,
  APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
} from './types'
import { useTextCompletion } from './use-text-completion'

type IDebug = {
  isAPIKeySet: boolean
  onSetting: () => void
  inputs: Inputs
  modelParameterParams: Pick<ModelParameterModalProps, 'setModel' | 'onCompletionParamsChange'>
  debugWithMultipleModel: boolean
  multipleModelConfigs: ModelAndParameter[]
  onMultipleModelConfigsChange: (multiple: boolean, modelConfigs: ModelAndParameter[]) => void
}

const Debug: FC<IDebug> = ({
  isAPIKeySet = true,
  onSetting,
  inputs,
  modelParameterParams,
  debugWithMultipleModel,
  multipleModelConfigs,
  onMultipleModelConfigsChange,
}) => {
  const {
    readonly,
    mode,
    modelConfig,
  } = useContext(ConfigContext)
  const { eventEmitter } = useEventEmitterContextContext()
  const { data: text2speechDefaultModel } = useDefaultModel(ModelTypeEnum.textEmbedding)
  const features = useFeatures(s => s.features)
  const featuresStore = useFeaturesStore()

  // Disable immer auto-freeze for this component
  useEffect(() => {
    setAutoFreeze(false)
    return () => {
      setAutoFreeze(true)
    }
  }, [])

  // UI state
  const [expanded, setExpanded] = useState(true)
  const [isShowCannotQueryDataset, setShowCannotQueryDataset] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debugWithSingleModelRef = React.useRef<DebugWithSingleModelRefType>(null!)

  // Hooks
  const { checkCanSend } = useInputValidation()
  const { isShowFormattingChangeConfirm, handleConfirm, handleCancel } = useFormattingChangeConfirm()
  const modalWidth = useModalWidth(containerRef)

  // Wrapper for checkCanSend that uses current completionFiles
  const [completionFilesForValidation, setCompletionFilesForValidation] = useState<VisionFile[]>([])
  const checkCanSendWithFiles = useCallback(() => {
    return checkCanSend(inputs, completionFilesForValidation)
  }, [checkCanSend, inputs, completionFilesForValidation])

  const {
    isResponding,
    completionRes,
    messageId,
    completionFiles,
    setCompletionFiles,
    sendTextCompletion,
  } = useTextCompletion({
    checkCanSend: checkCanSendWithFiles,
    onShowCannotQueryDataset: () => setShowCannotQueryDataset(true),
  })

  // Sync completionFiles for validation
  useEffect(() => {
    setCompletionFilesForValidation(completionFiles as VisionFile[]) // eslint-disable-line react-hooks-extra/no-direct-set-state-in-use-effect
  }, [completionFiles])

  // App store for modals
  const { currentLogItem, setCurrentLogItem, showPromptLogModal, setShowPromptLogModal, showAgentLogModal, setShowAgentLogModal } = useAppStore(useShallow(state => ({
    currentLogItem: state.currentLogItem,
    setCurrentLogItem: state.setCurrentLogItem,
    showPromptLogModal: state.showPromptLogModal,
    setShowPromptLogModal: state.setShowPromptLogModal,
    showAgentLogModal: state.showAgentLogModal,
    setShowAgentLogModal: state.setShowAgentLogModal,
  })))

  // Provider context for model list
  const { textGenerationModelList } = useProviderContext()

  // Computed values
  const varList = modelConfig.configs.prompt_variables.map((item: PromptVariable) => ({
    label: item.key,
    value: inputs[item.key],
  }))

  // Handlers
  const handleClearConversation = useCallback(() => {
    debugWithSingleModelRef.current?.handleRestart()
  }, [])

  const clearConversation = useCallback(async () => {
    if (debugWithMultipleModel) {
      eventEmitter?.emit({ type: APP_CHAT_WITH_MULTIPLE_MODEL_RESTART } as any) // eslint-disable-line ts/no-explicit-any
      return
    }
    handleClearConversation()
  }, [debugWithMultipleModel, eventEmitter, handleClearConversation])

  const handleFormattingConfirm = useCallback(() => {
    handleConfirm(clearConversation)
  }, [handleConfirm, clearConversation])

  const handleChangeToSingleModel = useCallback((item: ModelAndParameter) => {
    const currentProvider = textGenerationModelList.find(modelItem => modelItem.provider === item.provider)
    const currentModel = currentProvider?.models.find(model => model.model === item.model)

    modelParameterParams.setModel({
      modelId: item.model,
      provider: item.provider,
      mode: currentModel?.model_properties.mode as string,
      features: currentModel?.features,
    })
    modelParameterParams.onCompletionParamsChange(item.parameters)
    onMultipleModelConfigsChange(false, [])
  }, [modelParameterParams, onMultipleModelConfigsChange, textGenerationModelList])

  const handleVisionConfigInMultipleModel = useCallback(() => {
    if (debugWithMultipleModel && mode) {
      const supportedVision = multipleModelConfigs.some((config) => {
        const currentProvider = textGenerationModelList.find(modelItem => modelItem.provider === config.provider)
        const currentModel = currentProvider?.models.find(model => model.model === config.model)
        return currentModel?.features?.includes(ModelFeatureEnum.vision)
      })
      const { features: storeFeatures, setFeatures } = featuresStore!.getState()
      const newFeatures = produce(storeFeatures, (draft) => {
        draft.file = {
          ...draft.file,
          enabled: supportedVision,
        }
      })
      setFeatures(newFeatures)
    }
  }, [debugWithMultipleModel, featuresStore, mode, multipleModelConfigs, textGenerationModelList])

  useEffect(() => {
    handleVisionConfigInMultipleModel()
  }, [multipleModelConfigs, mode, handleVisionConfigInMultipleModel])

  const handleSendTextCompletion = useCallback(() => {
    if (debugWithMultipleModel) {
      eventEmitter?.emit({ type: APP_CHAT_WITH_MULTIPLE_MODEL, payload: { message: '', files: completionFiles } } as any) // eslint-disable-line ts/no-explicit-any
      return
    }
    sendTextCompletion()
  }, [completionFiles, debugWithMultipleModel, eventEmitter, sendTextCompletion])

  const handleAddModel = useCallback(() => {
    onMultipleModelConfigsChange(true, [...multipleModelConfigs, { id: `${Date.now()}`, model: '', provider: '', parameters: {} }])
  }, [multipleModelConfigs, onMultipleModelConfigsChange])

  const handleClosePromptLogModal = useCallback(() => {
    setCurrentLogItem()
    setShowPromptLogModal(false)
  }, [setCurrentLogItem, setShowPromptLogModal])

  const handleCloseAgentLogModal = useCallback(() => {
    setCurrentLogItem()
    setShowAgentLogModal(false)
  }, [setCurrentLogItem, setShowAgentLogModal])

  const isShowTextToSpeech = features.text2speech?.enabled && !!text2speechDefaultModel

  return (
    <>
      <div className="shrink-0">
        <DebugHeader
          readonly={readonly}
          mode={mode}
          debugWithMultipleModel={debugWithMultipleModel}
          multipleModelConfigs={multipleModelConfigs}
          varListLength={varList.length}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onClearConversation={clearConversation}
          onAddModel={handleAddModel}
        />
        {mode !== AppModeEnum.COMPLETION && expanded && (
          <div className="mx-3">
            <ChatUserInput inputs={inputs} />
          </div>
        )}
        {mode === AppModeEnum.COMPLETION && (
          <PromptValuePanel
            appType={mode as AppModeEnum}
            onSend={handleSendTextCompletion}
            inputs={inputs}
            visionConfig={{
              ...features.file! as VisionSettings,
              transfer_methods: features.file!.allowed_file_upload_methods || [],
              image_file_size_limit: features.file?.fileUploadConfig?.image_file_size_limit,
            }}
            onVisionFilesChange={setCompletionFiles}
          />
        )}
      </div>

      {debugWithMultipleModel && (
        <div className="mt-3 grow overflow-hidden" ref={containerRef}>
          <DebugWithMultipleModel
            multipleModelConfigs={multipleModelConfigs}
            onMultipleModelConfigsChange={onMultipleModelConfigsChange}
            onDebugWithMultipleModelChange={handleChangeToSingleModel}
            checkCanSend={checkCanSendWithFiles}
          />
          {showPromptLogModal && (
            <PromptLogModal
              width={modalWidth}
              currentLogItem={currentLogItem}
              onCancel={handleClosePromptLogModal}
            />
          )}
          {showAgentLogModal && (
            <AgentLogModal
              width={modalWidth}
              currentLogItem={currentLogItem}
              onCancel={handleCloseAgentLogModal}
            />
          )}
        </div>
      )}

      {!debugWithMultipleModel && (
        <div className="flex grow flex-col" ref={containerRef}>
          {mode !== AppModeEnum.COMPLETION && (
            <div className="h-0 grow overflow-hidden">
              <DebugWithSingleModel
                ref={debugWithSingleModelRef}
                checkCanSend={checkCanSendWithFiles}
              />
            </div>
          )}
          {mode === AppModeEnum.COMPLETION && (
            <TextCompletionResult
              completionRes={completionRes}
              isResponding={isResponding}
              messageId={messageId}
              isShowTextToSpeech={isShowTextToSpeech}
            />
          )}
          {mode === AppModeEnum.COMPLETION && showPromptLogModal && (
            <PromptLogModal
              width={modalWidth}
              currentLogItem={currentLogItem}
              onCancel={handleClosePromptLogModal}
            />
          )}
          {isShowCannotQueryDataset && (
            <CannotQueryDataset onConfirm={() => setShowCannotQueryDataset(false)} />
          )}
        </div>
      )}

      {isShowFormattingChangeConfirm && (
        <FormattingChanged
          onConfirm={handleFormattingConfirm}
          onCancel={handleCancel}
        />
      )}
      {!isAPIKeySet && !readonly && (
        <HasNotSetAPIKEY isTrailFinished={!IS_CE_EDITION} onSetting={onSetting} />
      )}
    </>
  )
}

export default React.memo(Debug)
