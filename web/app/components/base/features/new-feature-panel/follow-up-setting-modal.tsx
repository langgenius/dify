import type { AppModelSelectionResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { SuggestedQuestionsAfterAnswer } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CompletionParams, ModelModeType } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldItem } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RadioControl, RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { produce } from 'immer'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { ModelModeType as ModelModeTypeEnum } from '@/types/app'

type FollowUpSettingsDialogProps = {
  data: SuggestedQuestionsAfterAnswer
  onSave: (newState: SuggestedQuestionsAfterAnswer) => void
  disabled?: boolean
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

const getInitialModel = (model?: AppModelSelectionResponse) => ({
  provider: model?.provider || '',
  name: model?.name || '',
  mode: model?.mode || ModelModeTypeEnum.chat,
  completion_params: {
    ...(model?.completion_params ?? DEFAULT_COMPLETION_PARAMS),
  },
})

const PROMPT_MODE = {
  default: 'default',
  custom: 'custom',
} as const

type PromptMode = (typeof PROMPT_MODE)[keyof typeof PROMPT_MODE]

export function FollowUpSettingsDialog({ data, onSave, disabled }: FollowUpSettingsDialogProps) {
  const { t } = useTranslation(['appDebug', 'common'])
  const actionsRef = useRef<DialogActions>(null)

  return (
    <Dialog actionsRef={actionsRef}>
      <div className="relative min-h-8">
        <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary group-focus-within/follow-up:invisible group-hover/follow-up:invisible">
          {data.model?.name ||
            t(($) => $['feature.suggestedQuestionsAfterAnswer.modal.defaultModel'], {
              ns: 'appDebug',
            })}
        </div>
        <DialogTrigger
          render={
            <Button
              disabled={disabled}
              className="absolute inset-0 w-full opacity-0 group-focus-within/follow-up:opacity-100 group-hover/follow-up:opacity-100"
            />
          }
        >
          <span aria-hidden className="i-ri-equalizer-2-line size-4" />
          {t(($) => $['operation.settings'], { ns: 'common' })}
        </DialogTrigger>
      </div>
      <DialogContent className="w-160! max-w-none! p-8! pb-6!">
        <FollowUpSettingsForm
          data={data}
          onSave={(value) => {
            onSave(value)
            actionsRef.current?.close()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function FollowUpSettingsForm({ data, onSave }: Omit<FollowUpSettingsDialogProps, 'disabled'>) {
  const { t } = useTranslation(['appDebug', 'common'])
  const [model, setModel] = useState(() => getInitialModel(data.model))
  const [prompt, setPrompt] = useState(data.prompt || '')
  const [promptMode, setPromptMode] = useState<PromptMode>(
    data.prompt ? PROMPT_MODE.custom : PROMPT_MODE.default,
  )
  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(
    ModelTypeEnum.textGeneration,
  )
  const selectedModel = useMemo(() => {
    if (model.provider && model.name) return model

    if (!defaultModel) return model

    return {
      ...model,
      provider: defaultModel.provider.provider,
      name: defaultModel.model,
    }
  }, [defaultModel, model])

  const handleModelChange = useCallback(
    (newValue: { modelId: string; provider: string; mode?: string; features?: string[] }) => {
      setModel((prev) => ({
        ...prev,
        provider: newValue.provider,
        name: newValue.modelId,
        mode: (newValue.mode as ModelModeType) || prev.mode || ModelModeTypeEnum.chat,
      }))
    },
    [],
  )

  const handleCompletionParamsChange = useCallback(
    (newParams: FormValue) => {
      setModel({
        ...selectedModel,
        completion_params: newParams,
      })
    },
    [selectedModel],
  )

  const handleSave = useCallback(() => {
    const trimmedPrompt = prompt.trim()
    const nextFollowUpState = produce(data, (draft) => {
      if (selectedModel.provider && selectedModel.name) draft.model = selectedModel
      else draft.model = undefined

      draft.prompt = promptMode === PROMPT_MODE.custom ? trimmedPrompt || undefined : undefined
    })
    onSave(nextFollowUpState)
  }, [data, onSave, prompt, promptMode, selectedModel])

  const isCustomPromptInvalid = promptMode === PROMPT_MODE.custom && !prompt.trim()

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!isCustomPromptInvalid) handleSave()
      }}
    >
      <DialogClose
        render={
          <IconButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            size="lg"
            className="absolute top-8 right-8"
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </IconButton>
        }
      />
      <DialogTitle className="pr-8 text-xl font-semibold text-text-primary">
        {t(($) => $['feature.suggestedQuestionsAfterAnswer.modal.title'], { ns: 'appDebug' })}
      </DialogTitle>
      <div className="mt-6 space-y-4">
        <div>
          <div className="mb-1.5 system-sm-semibold-uppercase text-text-secondary">
            {t(($) => $['feature.suggestedQuestionsAfterAnswer.modal.modelLabel'], {
              ns: 'appDebug',
            })}
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
        <Field name="follow_up_prompt_mode" className="contents">
          <Fieldset
            render={
              <RadioGroup<PromptMode>
                className="flex-col items-stretch gap-3"
                value={promptMode}
                onValueChange={setPromptMode}
              />
            }
          >
            <FieldsetLegend className="mb-1.5 py-0 system-sm-semibold-uppercase text-text-secondary">
              {t(($) => $['feature.suggestedQuestionsAfterAnswer.modal.promptLabel'], {
                ns: 'appDebug',
              })}
            </FieldsetLegend>
            <FieldItem>
              <RadioItem<PromptMode>
                value={PROMPT_MODE.default}
                nativeButton
                render={<button type="button" />}
                className="w-full rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-4 text-left transition-colors hover:bg-state-base-hover data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:hover:bg-components-option-card-option-selected-bg"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="system-sm-semibold text-text-primary">
                      {t(
                        ($) => $['feature.suggestedQuestionsAfterAnswer.modal.defaultPromptOption'],
                        { ns: 'appDebug' },
                      )}
                    </div>
                    <div className="mt-1 system-xs-regular text-text-tertiary">
                      {t(
                        ($) =>
                          $[
                            'feature.suggestedQuestionsAfterAnswer.modal.defaultPromptOptionDescription'
                          ],
                        { ns: 'appDebug' },
                      )}
                    </div>
                  </div>
                  <RadioControl aria-hidden="true" />
                </div>
                {promptMode === PROMPT_MODE.default && (
                  <div className="mt-3 rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-3 py-2">
                    <div className="system-sm-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
                      {DEFAULT_FOLLOW_UP_PROMPT}
                    </div>
                  </div>
                )}
              </RadioItem>
            </FieldItem>
            <FieldItem
              className={cn(
                'rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-4 transition-colors hover:bg-state-base-hover',
                promptMode === PROMPT_MODE.custom &&
                  'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg hover:bg-components-option-card-option-selected-bg',
              )}
            >
              <RadioItem<PromptMode>
                value={PROMPT_MODE.custom}
                nativeButton
                render={<button type="button" />}
                className="w-full text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="system-sm-semibold text-text-primary">
                      {t(
                        ($) => $['feature.suggestedQuestionsAfterAnswer.modal.customPromptOption'],
                        { ns: 'appDebug' },
                      )}
                    </div>
                    <div className="mt-1 system-xs-regular text-text-tertiary">
                      {t(
                        ($) =>
                          $[
                            'feature.suggestedQuestionsAfterAnswer.modal.customPromptOptionDescription'
                          ],
                        { ns: 'appDebug' },
                      )}
                    </div>
                  </div>
                  <RadioControl aria-hidden="true" />
                </div>
              </RadioItem>
              {promptMode === PROMPT_MODE.custom && (
                <Textarea
                  aria-label={t(
                    ($) => $['feature.suggestedQuestionsAfterAnswer.modal.customPromptOption'],
                    { ns: 'appDebug' },
                  )}
                  className="mt-3 min-h-32 resize-y border-components-input-border-active bg-components-input-bg-normal"
                  value={prompt}
                  onValueChange={(value) => setPrompt(value)}
                  maxLength={CUSTOM_FOLLOW_UP_PROMPT_MAX_LENGTH}
                  placeholder={
                    t(($) => $['feature.suggestedQuestionsAfterAnswer.modal.promptPlaceholder'], {
                      ns: 'appDebug',
                    }) || ''
                  }
                />
              )}
            </FieldItem>
          </Fieldset>
        </Field>
      </div>
      <div className="mt-6 flex items-center justify-end gap-2">
        <DialogClose render={<Button />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary" disabled={isCustomPromptInvalid}>
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </form>
  )
}
