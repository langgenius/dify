import type { SessionModel } from './types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useDefaultModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import {
  difyBuilderModelReadonlyAtom,
  difyBuilderSelectedModelAtom,
  difyBuilderSelectModelAtom,
  difyBuilderSessionModelAtom,
} from './store'

const DifyBuilderModelSelector = () => {
  const { t } = useTranslation()
  const readonly = useAtomValue(difyBuilderModelReadonlyAtom)
  const selectedModel = useAtomValue(difyBuilderSelectedModelAtom)
  const sessionModel = useAtomValue(difyBuilderSessionModelAtom)
  const selectModel = useSetAtom(difyBuilderSelectModelAtom)
  const { data: defaultModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { activeTextGenerationModelList } = useTextGenerationCurrentProviderAndModelAndModelList()
  const model = useMemo<SessionModel | null>(() => {
    if (selectedModel) return selectedModel
    if (sessionModel) return sessionModel
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
  }, [activeTextGenerationModelList, defaultModel, selectedModel, sessionModel])

  const commitModel = (nextModel: SessionModel) => {
    void selectModel(nextModel)
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
          aria-label={t(($) => $['modelProvider.model'], { ns: 'common' })}
          className="flex min-w-0 items-center gap-0.5 rounded-md p-1 text-left system-xs-regular text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
        >
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
