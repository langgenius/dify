import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
} from 'react'
import {
  useConfigFromDebugContext,
  useFormattingChangedSubscription,
} from '../hooks'
import Chat from '@/app/components/base/chat/chat'
import { useChat } from '@/app/components/base/chat/chat/hooks'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import type { OnSend } from '@/app/components/base/chat/types'
import { useProviderContext } from '@/context/provider-context'
import {
  fetchConvesationMessages,
  fetchSuggestedQuestions,
  stopChatMessageResponding,
} from '@/service/debug'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

type DebugWithSingleModelProps = {
  checkCanSend?: () => boolean
}
export type DebugWithSingleModelRefType = {
  handleRestart: () => void
}
const DebugWithSingleModel = forwardRef<DebugWithSingleModelRefType, DebugWithSingleModelProps>(({
  checkCanSend,
}, ref) => {
  const { userProfile } = useAppContext()
  const {
    modelConfig,
    appId,
    inputs,
    visionConfig,
    collectionList,
    completionParams,
  } = useDebugConfigurationContext()
  const { textGenerationModelList } = useProviderContext()
  const config = useConfigFromDebugContext()
  const {
    chatList,
    isResponding,
    handleSend,
    suggestedQuestions,
    handleStop,
    handleRestart,
    handleAnnotationAdded,
    handleAnnotationEdited,
    handleAnnotationRemoved,
  } = useChat(
    config,
    {
      inputs,
      promptVariables: modelConfig.configs.prompt_variables,
    },
    [],
    taskId => stopChatMessageResponding(appId, taskId),
  )
  useFormattingChangedSubscription(chatList)

  const doSend: OnSend = useCallback((message, files) => {
    if (checkCanSend && !checkCanSend())
      return
    const currentProvider = textGenerationModelList.find(item => item.provider === modelConfig.provider)
    const currentModel = currentProvider?.models.find(model => model.model === modelConfig.model_id)
    const supportVision = currentModel?.features?.includes(ModelFeatureEnum.vision)

    const configData = {
      ...config,
      model: {
        provider: modelConfig.provider,
        name: modelConfig.model_id,
        mode: modelConfig.mode,
        completion_params: completionParams,
      },
    }

    const data: any = {
      query: message,
      inputs,
      model_config: configData,
    }

    if (visionConfig.enabled && files?.length && supportVision)
      data.files = files

    handleSend(
      `apps/${appId}/chat-messages`,
      data,
      {
        onGetConvesationMessages: (conversationId, getAbortController) => fetchConvesationMessages(appId, conversationId, getAbortController),
        onGetSuggestedQuestions: (responseItemId, getAbortController) => fetchSuggestedQuestions(appId, responseItemId, getAbortController),
      },
    )
  }, [appId, checkCanSend, completionParams, config, handleSend, inputs, modelConfig, textGenerationModelList, visionConfig.enabled])

  const allToolIcons = useMemo(() => {
    const icons: Record<string, any> = {}
    modelConfig.agentConfig.tools?.forEach((item: any) => {
      icons[item.tool_name] = collectionList.find((collection: any) => collection.id === item.provider_id)?.icon
    })
    return icons
  }, [collectionList, modelConfig.agentConfig.tools])

  useImperativeHandle(ref, () => {
    return {
      handleRestart,
    }
  }, [handleRestart])

  return (
    <Chat
      config={config}
      chatList={chatList}
      isResponding={isResponding}
      chatContainerClassName='p-6'
      chatFooterClassName='px-6 pt-10 pb-4'
      suggestedQuestions={suggestedQuestions}
      onSend={doSend}
      onStopResponding={handleStop}
      showPromptLog
      questionIcon={<Avatar name={userProfile.name} size={40} />}
      allToolIcons={allToolIcons}
      onAnnotationEdited={handleAnnotationEdited}
      onAnnotationAdded={handleAnnotationAdded}
      onAnnotationRemoved={handleAnnotationRemoved}
    />
  )
})

DebugWithSingleModel.displayName = 'DebugWithSingleModel'

export default memo(DebugWithSingleModel)
