import type { WorkflowInstructionImprovePayload } from '@dify/contracts/api/console/workflow-generate/types.gen'
import type { Dispatch, SetStateAction } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { BuilderPromptModelGuide } from '../builder-prompt-model-guide'
import { useImproveBuilderPrompt } from '../use-improve-builder-prompt'

type AppBuilderInputProps = {
  titleId: string
  prompt: string
  onPromptChange: Dispatch<SetStateAction<string>>
  mode: WorkflowInstructionImprovePayload['mode']
  isCreating: boolean
  createDisabled: boolean
}

export function AppBuilderInput({
  titleId,
  prompt,
  onPromptChange,
  mode,
  isCreating,
  createDisabled,
}: AppBuilderInputProps) {
  const { t } = useTranslation()
  const { improve, isPending, ...modelState } = useImproveBuilderPrompt(mode, onPromptChange)

  return (
    <div className="flex h-40 flex-col rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur p-2.5 shadow-md focus-within:border-components-input-border-active-prompt-1">
      <textarea
        aria-labelledby={titleId}
        placeholder={t(($) => $['newApp.builderPromptPlaceholder'], { ns: 'app' })}
        value={prompt}
        onChange={(event) => onPromptChange(event.currentTarget.value)}
        disabled={isCreating}
        className="min-h-15 w-full grow resize-none rounded-md bg-transparent px-2 py-1 body-md-regular text-text-primary outline-none placeholder:text-text-placeholder"
      />
      <div className="flex shrink-0 items-center justify-between">
        <BuilderPromptModelGuide {...modelState}>
          <Button
            type="button"
            variant="ghost-accent"
            size="small"
            disabled={isCreating || !prompt.trim() || modelState.modelStatus !== 'ready'}
            focusableWhenDisabled={modelState.modelStatus !== 'ready' || isPending}
            loading={isPending}
            onClick={() => improve(prompt)}
          >
            <span aria-hidden className="i-ri-sparkling-fill size-3.5" />
            {t(($) => $['newApp.optimizeWithAI'], { ns: 'app' })}
          </Button>
        </BuilderPromptModelGuide>
        <IconButton
          type="submit"
          variant="primary"
          size="lg"
          aria-label={t(($) => $['difyBuilder.messageSend'], { ns: 'workflow' })}
          disabled={createDisabled || isCreating || !prompt.trim()}
        >
          <span
            aria-hidden
            className={
              isCreating
                ? 'i-ri-loader-4-line size-4 animate-spin'
                : 'i-ri-send-plane-2-fill size-4'
            }
          />
        </IconButton>
      </div>
    </div>
  )
}
