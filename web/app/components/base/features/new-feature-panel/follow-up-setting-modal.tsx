import type { SuggestedQuestionsAfterAnswer } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  CompletionParams,
  Model,
  ModelModeType,
} from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { produce } from 'immer'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Radio from '@/app/components/base/radio/ui'
import Textarea from '@/app/components/base/textarea'
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

const DEFAULT_FOLLOW_UP_PROMPT = `Please predict the three most likely follow-up questions a user would ask, keep each question under 20 characters, use the same language as the assistant's latest response, and output a JSON array like ["question1", "question2", "question3"].`
const CUSTOM_FOLLOW_UP_PROMPT_MAX_LENGTH = 1000

const getInitialModel = (model?: Model): Model => ({
  provider: model?.provider || '',
  name: model?.name || '',
  mode: model?.mode || ModelModeTypeEnum.chat,
  completion_params: {
    ...DEFAULT_COMPLETION_PARAMS,
    ...(model?.completion_params || {}),
  },
})

const PROMPT_MODE = {
  default: 'default',
  custom: 'custom',
} as const

type PromptMode = typeof PROMPT_MODE[keyof typeof PROMPT_MODE]

const FollowUpSettingModal = ({
  data,
  onSave,
  onCancel,
}: FollowUpSettingModalProps) => {
  const { t } = useTranslation()
  const [model, setModel] = useState<Model>(() => getInitialModel(data.model))
  const [prompt, setPrompt] = useState(data.prompt || '')
  const [promptMode, setPromptMode] = useState<PromptMode>(
    data.prompt ? PROMPT_MODE.custom : PROMPT_MODE.default,
  )
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

      draft.prompt = promptMode === PROMPT_MODE.custom
        ? (trimmedPrompt || undefined)
        : undefined
    })
    onSave(nextFollowUpState)
  }, [data, onSave, prompt, promptMode, selectedModel])

  const isCustomPromptInvalid = promptMode === PROMPT_MODE.custom && !prompt.trim()

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
            <div className="space-y-3" role="radiogroup" aria-label={t('feature.suggestedQuestionsAfterAnswer.modal.promptLabel', { ns: 'appDebug' }) || ''}>
              <button
                type="button"
                role="radio"
                aria-checked={promptMode === PROMPT_MODE.default}
                className={cn(
                  'w-full rounded-xl border p-4 text-left transition-colors',
                  promptMode === PROMPT_MODE.default
                    ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg'
                    : 'border-components-option-card-option-border bg-components-option-card-option-bg hover:bg-state-base-hover',
                )}
                onClick={() => setPromptMode(PROMPT_MODE.default)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="system-sm-semibold text-text-primary">
                      {t('feature.suggestedQuestionsAfterAnswer.modal.defaultPromptOption', { ns: 'appDebug' })}
                    </div>
                    <div className="mt-1 system-xs-regular text-text-tertiary">
                      {t('feature.suggestedQuestionsAfterAnswer.modal.defaultPromptOptionDescription', { ns: 'appDebug' })}
                    </div>
                  </div>
                  <div aria-hidden="true">
                    <Radio isChecked={promptMode === PROMPT_MODE.default} />
                  </div>
                </div>
                {promptMode === PROMPT_MODE.default && (
                  <div className="mt-3 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-3 py-2">
                    <div className="system-sm-regular break-words whitespace-pre-wrap text-text-secondary">
                      {DEFAULT_FOLLOW_UP_PROMPT}
                    </div>
                  </div>
                )}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={promptMode === PROMPT_MODE.custom}
                className={cn(
                  'w-full rounded-xl border p-4 text-left transition-colors',
                  promptMode === PROMPT_MODE.custom
                    ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg'
                    : 'border-components-option-card-option-border bg-components-option-card-option-bg hover:bg-state-base-hover',
                )}
                onClick={() => setPromptMode(PROMPT_MODE.custom)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="system-sm-semibold text-text-primary">
                      {t('feature.suggestedQuestionsAfterAnswer.modal.customPromptOption', { ns: 'appDebug' })}
                    </div>
                    <div className="mt-1 system-xs-regular text-text-tertiary">
                      {t('feature.suggestedQuestionsAfterAnswer.modal.customPromptOptionDescription', { ns: 'appDebug' })}
                    </div>
                  </div>
                  <div aria-hidden="true">
                    <Radio isChecked={promptMode === PROMPT_MODE.custom} />
                  </div>
                </div>
                {promptMode === PROMPT_MODE.custom && (
                  <Textarea
                    className="mt-3 min-h-32 resize-y border-components-input-border-active bg-components-input-bg-normal"
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    maxLength={CUSTOM_FOLLOW_UP_PROMPT_MAX_LENGTH}
                    placeholder={t('feature.suggestedQuestionsAfterAnswer.modal.promptPlaceholder', { ns: 'appDebug' }) || ''}
                  />
                )}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button onClick={onCancel}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            disabled={isCustomPromptInvalid}
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
