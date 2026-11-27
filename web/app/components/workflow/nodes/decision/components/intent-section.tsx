import type { HotkeyChord } from '@tanstack/react-hotkeys'
import type { FC } from 'react'
import type { GenerateFeedback } from '../use-config'
import { Button } from '@langgenius/dify-ui/button'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'

const i18nPrefix = 'nodes.decision'

const GENERATE_HOTKEY = 'Mod+Enter' satisfies HotkeyChord

type IntentSectionProps = {
  intent: string
  readonly: boolean
  isGenerating: boolean
  feedback: GenerateFeedback
  // No outcome is named yet: the node is still empty, so the placeholder
  // teaches the one-sentence entry point.
  isEmpty: boolean
  onChange: (intent: string) => void
  onGenerate: () => void
}

const IntentSection: FC<IntentSectionProps> = ({
  intent,
  readonly,
  isGenerating,
  feedback,
  isEmpty,
  onChange,
  onGenerate,
}) => {
  const { t } = useTranslation(['workflow'])
  const canGenerate = !readonly && !isGenerating && intent.trim() !== ''
  const title = t(($) => $[`${i18nPrefix}.intent`], { ns: 'workflow' })
  // Generate results concern the whole sentence, not one field: they are
  // announced as alerts and linked to the textarea as its description.
  const feedbackId = useId()
  const feedbackAlert =
    feedback?.kind === 'noModel'
      ? t(($) => $[`${i18nPrefix}.noModelToGenerate`], { ns: 'workflow' })
      : feedback?.kind === 'error'
        ? feedback.message
        : null

  return (
    <Field title={title} className="px-4 py-2">
      <form
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault()
          onGenerate()
        }}
      >
        <div className="flex items-start gap-2">
          <textarea
            className="h-20 grow resize-none rounded-lg border border-divider-regular bg-components-input-bg-normal px-2 py-1.5 text-xs leading-5 font-normal text-text-secondary outline-none focus:border-components-input-border-active"
            value={intent}
            readOnly={readonly}
            aria-label={title}
            aria-describedby={feedbackAlert ? feedbackId : undefined}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.defaultPrevented || e.nativeEvent.isComposing || e.repeat || !canGenerate)
                return
              if (matchesKeyboardEvent(e.nativeEvent, GENERATE_HOTKEY)) {
                e.preventDefault()
                e.stopPropagation()
                onGenerate()
              }
            }}
            placeholder={
              isEmpty
                ? t(($) => $[`${i18nPrefix}.intentPlaceholderWhenEmpty`], { ns: 'workflow' })
                : t(($) => $[`${i18nPrefix}.intentPlaceholder`], { ns: 'workflow' })
            }
          />
          <Button
            className="shrink-0"
            type="submit"
            size="small"
            variant="primary"
            loading={isGenerating}
            disabled={!canGenerate}
          >
            {t(($) => $[`${i18nPrefix}.generate`], { ns: 'workflow' })}
          </Button>
        </div>
        <div className="mt-1 text-xs leading-4 font-normal text-text-tertiary">
          {t(($) => $[`${i18nPrefix}.intentHelper`], { ns: 'workflow' })}
        </div>
        {feedbackAlert && (
          <div
            id={feedbackId}
            role="alert"
            className={`mt-1 text-xs leading-4 font-normal ${
              feedback?.kind === 'noModel' ? 'text-text-warning-secondary' : 'text-text-destructive'
            }`}
          >
            {feedbackAlert}
          </div>
        )}
      </form>
    </Field>
  )
}

export default IntentSection
