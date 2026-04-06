import type { SuggestedQuestionsAfterAnswer } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  CompletionParams,
  Model,
  ModelModeType,
} from '@/types/app'
import { produce } from 'immer'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { ModelModeType as ModelModeTypeEnum } from '@/types/app'

type FollowUpSettingModalProps = {
  data: SuggestedQuestionsAfterAnswer
  onSave: (newState: SuggestedQuestionsAfterAnswer) => void
  onCancel: () => void
}

const DEFAULT_COMPLETION_PARAMS: CompletionParams = {
  temperature: 0.7,
  max_tokens: 0,
  top_p: 0,
  echo: false,
  stop: [],
  presence_penalty: 0,
  frequency_penalty: 0,
}

const getInitialModel = (model?: Model): Model => ({
  provider: model?.provider || '',
  name: model?.name || '',
  mode: model?.mode || ModelModeTypeEnum.chat,
  completion_params: {
    ...DEFAULT_COMPLETION_PARAMS,
    ...(model?.completion_params || {}),
  },
})

const FollowUpSettingModal = ({
  data,
  onSave,
  onCancel,
}: FollowUpSettingModalProps) => {
  const { t } = useTranslation()
  const [model, setModel] = useState<Model>(() => getInitialModel(data.model))
  const [prompt, setPrompt] = useState(data.prompt || '')
  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)
  const selectedModel = useMemo<Model>(() => {
    if (model.provider && model.name)
      return model

    if (!defaultModel)
      return model

    return {
      ...model,
      provider: defaultModel.provider.provider,
      name: defaultModel.model,
    }
  }, [defaultModel, model])

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
    setModel(prev => ({
      ...prev,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: (newValue.mode as ModelModeType) || prev.mode || ModelModeTypeEnum.chat,
    }))
  }, [])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    setModel({
      ...selectedModel,
      completion_params: {
        ...DEFAULT_COMPLETION_PARAMS,
        ...(newParams as Partial<CompletionParams>),
      },
    })
  }, [selectedModel])

  const handleSave = useCallback(() => {
    const trimmedPrompt = prompt.trim()
    const nextFollowUpState = produce(data, (draft) => {
      if (selectedModel.provider && selectedModel.name)
        draft.model = selectedModel
      else
        draft.model = undefined

      draft.prompt = trimmedPrompt || undefined
    })
    onSave(nextFollowUpState)
  }, [data, onSave, prompt, selectedModel])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <DialogContent className="w-[640px]! max-w-none! p-8! pb-6!">
        <DialogCloseButton className="top-8 right-8" />
        <DialogTitle className="pr-8 text-xl font-semibold text-text-primary">
          {t('feature.suggestedQuestionsAfterAnswer.modal.title', { ns: 'appDebug' })}
        </DialogTitle>
        <div className="mt-6 space-y-4">
          <div>
            <div className="mb-1.5 system-sm-semibold-uppercase text-text-secondary">
              {t('feature.suggestedQuestionsAfterAnswer.modal.modelLabel', { ns: 'appDebug' })}
            </div>
            <ModelParameterModal
              popupClassName="w-[520px]!"
              isAdvancedMode
              provider={selectedModel.provider}
              completionParams={selectedModel.completion_params}
              modelId={selectedModel.name}
              setModel={handleModelChange}
              onCompletionParamsChange={handleCompletionParamsChange}
              hideDebugWithMultipleModel
            />
          </div>
          <div>
            <div className="mb-1.5 system-sm-semibold-uppercase text-text-secondary">
              {t('feature.suggestedQuestionsAfterAnswer.modal.promptLabel', { ns: 'appDebug' })}
            </div>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={t('feature.suggestedQuestionsAfterAnswer.modal.promptPlaceholder', { ns: 'appDebug' }) || ''}
              className="block min-h-32 w-full resize-y appearance-none rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-3 py-2 text-sm text-components-input-text-filled outline-hidden"
            />
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button onClick={onCancel}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
          >
            {t('operation.save', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default FollowUpSettingModal
