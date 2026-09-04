'use client'

import type { ModelParameterModalProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import type {
  LLMCompletionParams,
  LLMEnvironmentVariableValue,
} from '@/app/components/workflow/types'
import { toast } from '@langgenius/dify-ui/toast'
import { useTranslation } from 'react-i18next'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'

export function LLMEnvironmentVariableValueField({
  disabled = false,
  popupClassName,
  requiredMode,
  value,
  onChange,
}: {
  disabled?: boolean
  popupClassName?: string
  requiredMode?: string
  value?: LLMEnvironmentVariableValue
  onChange: (value: LLMEnvironmentVariableValue) => void
}) {
  const { t } = useTranslation()
  const { activeTextGenerationModelList } = useTextGenerationCurrentProviderAndModelAndModelList()
  const selectableModelList = requiredMode
    ? activeTextGenerationModelList
        .map((provider) => ({
          ...provider,
          models: provider.models.filter((model) => model.model_properties.mode === requiredMode),
        }))
        .filter((provider) => provider.models.length > 0)
    : activeTextGenerationModelList

  const handleModelSelect: ModelParameterModalProps['setModel'] = ({ provider, modelId }) => {
    const targetProvider = activeTextGenerationModelList.find(
      (providerItem) => providerItem.provider === provider,
    )
    const targetModel = targetProvider?.models.find((modelItem) => modelItem.model === modelId)
    const mode = targetModel?.model_properties.mode

    if (typeof mode !== 'string') return
    if (requiredMode && mode !== requiredMode) {
      toast.error(t(($) => $['modelProvider.selector.incompatibleTip'], { ns: 'common' }))
      return
    }

    const completionParams =
      value?.provider === provider && value.name === modelId ? (value.completion_params ?? {}) : {}
    onChange({
      completion_params: completionParams,
      mode,
      name: modelId,
      provider,
    })
  }

  const handleCompletionParamsChange = (completionParams: LLMCompletionParams) => {
    if (!value) return
    onChange({ ...value, completion_params: completionParams })
  }

  return (
    <ModelParameterModal
      triggerContainerClassName="w-full min-w-0"
      provider={value?.provider ?? ''}
      modelId={value?.name ?? ''}
      completionParams={value?.completion_params ?? {}}
      modelList={selectableModelList}
      popupClassName={popupClassName}
      isAdvancedMode={true}
      setModel={handleModelSelect}
      onCompletionParamsChange={handleCompletionParamsChange}
      readonly={disabled}
      modelSelectorReadonly={disabled}
      hideDebugWithMultipleModel
      debugWithMultipleModel={false}
    />
  )
}
