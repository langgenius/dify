import { useAtom } from 'jotai'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDefaultModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'

export function useAgentEditorModel() {
  const [model, setModel] = useAtom(agentComposerModelAtom)
  const { data: defaultTextGenerationModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const defaultModel = defaultTextGenerationModel
    ? {
        provider: defaultTextGenerationModel.provider.provider,
        model: defaultTextGenerationModel.model,
      }
    : undefined
  const currentModel = model ?? defaultModel

  return {
    currentModel,
    setConfigureModel: setModel,
  }
}
