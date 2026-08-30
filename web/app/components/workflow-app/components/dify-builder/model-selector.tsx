import type { DifyBuilderModelConfigPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useDefaultModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { useDifyBuilder } from './context'

const DifyBuilderModelSelector = () => {
  const { t } = useTranslation()
  const { view, selectedModel, setSelectedModel, updateModel, isBusy } = useDifyBuilder()
  const { data: defaultModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { activeTextGenerationModelList } = useTextGenerationCurrentProviderAndModelAndModelList()
  const model = useMemo<DifyBuilderModelConfigPayload | null>(() => {
    if (selectedModel) return selectedModel
    if (view?.model) {
      return {
        provider: view.model.provider,
        name: view.model.name,
        mode: view.model.mode ?? '',
        completion_params: view.model.completion_params ?? {},
      }
    }
    if (!defaultModel) return null
    const provider = defaultModel.provider.provider
    const targetProvider = activeTextGenerationModelList.find((item) => item.provider === provider)
    const targetModel = targetProvider?.models.find((item) => item.model === defaultModel.model)
    return {
      provider,
      name: defaultModel.model,
      mode: String(targetModel?.model_properties.mode ?? ''),
      completion_params: {},
    }
  }, [activeTextGenerationModelList, defaultModel, selectedModel, view?.model])
  const readonly = isBusy || view?.run_status === 'executing'

  const commitModel = (nextModel: DifyBuilderModelConfigPayload) => {
    if (!view || view.run_status === 'complete' || view.run_status === 'failed') {
      setSelectedModel(nextModel)
      return
    }
    void updateModel(nextModel)
  }

  return (
    <ModelParameterModal
      provider={model?.provider ?? ''}
      modelId={model?.name ?? ''}
      completionParams={(model?.completion_params ?? {}) as FormValue}
      modelList={activeTextGenerationModelList}
      popupClassName="w-[340px]! max-w-[340px]!"
      placement="top-start"
      isAdvancedMode
      readonly={readonly}
      modelSelectorReadonly={readonly}
      setModel={({ provider, modelId, mode }) => {
        const completionParams =
          model?.provider === provider && model.name === modelId
            ? (model.completion_params ?? {})
            : {}
        commitModel({
          provider,
          name: modelId,
          mode: mode ?? '',
          completion_params: completionParams,
        })
      }}
      onCompletionParamsChange={(completionParams) => {
        if (!model) return
        commitModel({ ...model, completion_params: completionParams })
      }}
      hideDebugWithMultipleModel
      debugWithMultipleModel={false}
      trigger={
        <button
          type="button"
          disabled={readonly}
          className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left system-xs-medium text-text-secondary hover:bg-state-base-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden className="i-ri-brain-2-line size-3.5 shrink-0 text-text-tertiary" />
          <span className="max-w-36 truncate">
            {model?.name || t(($) => $['modelProvider.model'], { ns: 'common' })}
          </span>
          <span
            aria-hidden
            className="i-ri-arrow-down-s-line size-3.5 shrink-0 text-text-tertiary"
          />
        </button>
      }
    />
  )
}

export default DifyBuilderModelSelector
