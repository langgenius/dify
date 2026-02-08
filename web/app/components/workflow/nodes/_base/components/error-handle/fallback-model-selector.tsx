import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelConfig } from '@/app/components/workflow/types'
import { RiAddLine, RiDeleteBin7Line } from '@remixicon/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'

type FallbackModelSelectorProps = {
  models: ModelConfig[]
  primaryModel: ModelConfig
  onChange: (models: ModelConfig[]) => void
  readonly?: boolean
}

const FallbackModelSelector = ({
  models,
  primaryModel,
  onChange,
  readonly = false,
}: FallbackModelSelectorProps) => {
  const { t } = useTranslation()

  const handleAddModel = useCallback(() => {
    const newModel: ModelConfig = {
      provider: primaryModel.provider,
      name: primaryModel.name,
      mode: primaryModel.mode,
      completion_params: {},
    }
    onChange([...models, newModel])
  }, [models, primaryModel, onChange])

  const handleRemoveModel = useCallback((index: number) => {
    onChange(models.filter((_, i) => i !== index))
  }, [models, onChange])

  const handleModelChange = useCallback(async (
    index: number,
    model: {
      provider: string
      modelId: string
      mode?: string
    },
  ) => {
    try {
      const { params: filtered, removedDetails } = await fetchAndMergeValidCompletionParams(
        model.provider,
        model.modelId,
        models[index].completion_params || {},
        true,
      )
      const keys = Object.keys(removedDetails)
      if (keys.length) {
        Toast.notify({
          type: 'warning',
          message: `${t('modelProvider.parametersInvalidRemoved', { ns: 'common' })}: ${keys.map(k => `${k} (${removedDetails[k]})`).join(', ')}`,
        })
      }

      const newModels = [...models]
      newModels[index] = {
        provider: model.provider,
        name: model.modelId,
        mode: model.mode || primaryModel.mode,
        completion_params: filtered,
      }
      onChange(newModels)
    }
    catch {
      Toast.notify({ type: 'error', message: t('error', { ns: 'common' }) })
    }
  }, [models, primaryModel, onChange, t])

  const handleCompletionParamsChange = useCallback((index: number, params: FormValue) => {
    const newModels = [...models]
    newModels[index] = {
      ...newModels[index],
      completion_params: params,
    }
    onChange(newModels)
  }, [models, onChange])

  return (
    <div className="space-y-3 px-4 pt-2">
      {models.map((model, index) => (
        <div
          key={index}
          className="flex items-start gap-2 rounded-lg"
        >
          <div className="grow">
            <div className="mb-2 flex items-center justify-between">
              <div className="system-xs-semibold text-text-secondary">
                {t('nodes.common.errorHandle.fallbackModel.modelIndex', { ns: 'workflow', index: index + 1 })}
              </div>
              {!readonly && (
                <Button
                  className="!h-6 !w-6 !p-0"
                  onClick={() => handleRemoveModel(index)}
                >
                  <RiDeleteBin7Line className="h-4 w-4" />
                </Button>
              )}
            </div>
            <ModelParameterModal
              popupClassName="!w-[387px]"
              isInWorkflow
              isAdvancedMode={true}
              provider={model?.provider}
              completionParams={model?.completion_params}
              modelId={model?.name}
              setModel={m => handleModelChange(index, m)}
              onCompletionParamsChange={params => handleCompletionParamsChange(index, params)}
              hideDebugWithMultipleModel
              debugWithMultipleModel={false}
              readonly={readonly}
            />
          </div>
        </div>
      ))}
      {!readonly && (
        <Button
          className="w-full"
          onClick={handleAddModel}
        >
          <RiAddLine className="h-4 w-4" />
          {t('nodes.common.errorHandle.fallbackModel.addModel', { ns: 'workflow' })}
        </Button>
      )}
    </div>
  )
}

export default FallbackModelSelector
