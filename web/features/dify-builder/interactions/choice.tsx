import type { ReactNode } from 'react'
import type { DifyBuilderDecision, SessionView } from '../types'
import type { SubmitInteraction } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PreflightContextCard } from '../cards/preflight-context-card'
import { RunContextCard } from '../cards/run-context-card'
import { useDifyBuilderLocale } from '../i18n/use-builder-locale'
import { useBuilderText } from '../i18n/use-builder-text'
import { InteractionDockShell } from './dock-shell'

export const ChoiceInteraction = ({
  actions,
  busy,
  children,
  decision,
  context,
  recheckReady,
  submitInteraction,
}: {
  actions: SessionView['actions']
  busy: boolean
  children?: ReactNode
  decision: DifyBuilderDecision
  context: SessionView['pending_fix_context']
  recheckReady: boolean
  submitInteraction: SubmitInteraction
}) => {
  const locale = useDifyBuilderLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  const formId = useId()
  const options = decision.options ?? []
  const { renderText } = useBuilderText()
  const title = renderText(decision.title)
  const description = renderText(decision.description)
  const requiresConsent = options.some((option) => option.id === 'confirm_test_operation')
  const defaultOptionId = decision.default_option_id || options[0]?.id || ''
  const requiresExplicitChoice =
    requiresConsent || defaultOptionId === 'publish' || defaultOptionId === 'publish_workflow'
  const [selectedId, setSelectedId] = useState(requiresExplicitChoice ? '' : defaultOptionId)
  const [freeText, setFreeText] = useState('')
  const [pending, setPending] = useState(false)
  const selectedOption = options.find((option) => option.id === selectedId)
  const optionInput = selectedOption?.input
  const trimmedFreeText = freeText.trim()
  const inputValid =
    !optionInput ||
    ((!optionInput.required || trimmedFreeText.length > 0) &&
      trimmedFreeText.length >= (optionInput.min_length ?? 0) &&
      trimmedFreeText.length <= (optionInput.max_length ?? 100))
  const canSubmit =
    Boolean(selectedOption) && inputValid && (selectedId !== 'recheck' || recheckReady)

  const handleSubmit = async () => {
    if (busy || pending || !canSubmit) return
    setPending(true)
    try {
      await submitInteraction('confirm', {
        ...actions?.find((action) => action.id === selectedId)?.payload,
        option_id: selectedId,
        ...(optionInput && trimmedFreeText ? { free_text: trimmedFreeText } : {}),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <InteractionDockShell
      title={title}
      description={
        children ? (
          <>
            {description && (
              <p className="mb-2 system-xs-regular text-text-secondary">{description}</p>
            )}
            {children}
          </>
        ) : (
          description
        )
      }
      footer={
        <Button
          type="submit"
          form={formId}
          size="small"
          variant="primary"
          className="h-auto min-h-6 max-w-full py-1 whitespace-normal"
          loading={pending}
          disabled={pending ? false : busy || !canSubmit}
        >
          {renderText(selectedOption?.label) ||
            renderText(decision.submit?.label) ||
            t(($) => $['operation.submit'], { ns: 'common' })}
        </Button>
      }
    >
      {context &&
        ('run_id' in context ? (
          <RunContextCard payload={context} invalidated={false} />
        ) : (
          <PreflightContextCard payload={context} invalidated={false} />
        ))}
      <form
        className="-mx-1"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <RadioGroup
          aria-label={title}
          className="flex-col items-stretch gap-1"
          value={selectedId}
          disabled={busy || pending}
          onValueChange={setSelectedId}
        >
          {options.map((option) => (
            <RadioItem
              key={option.id}
              value={option.id}
              nativeButton
              render={<button type="button" />}
              className="group/choice flex min-h-9 w-full cursor-pointer items-center rounded-[10px] border border-transparent bg-background-section px-3 py-2.5 text-start system-sm-medium text-text-secondary outline-hidden transition-colors hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-state-accent-solid/30 data-checked:bg-util-colors-blue-brand-blue-brand-50 data-checked:text-text-primary data-checked:hover:border-state-accent-solid/30 data-checked:hover:bg-util-colors-blue-brand-blue-brand-50 data-disabled:cursor-not-allowed data-disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block">{renderText(option.label)}</span>
                {option.description && (
                  <span className="mt-0.5 block system-xs-regular text-text-tertiary group-data-checked/choice:text-text-secondary">
                    {renderText(option.description)}
                  </span>
                )}
              </span>
            </RadioItem>
          ))}
        </RadioGroup>
        {optionInput && (
          <Textarea
            value={freeText}
            disabled={busy || pending}
            required={optionInput.required}
            minLength={optionInput.min_length}
            maxLength={optionInput.max_length}
            aria-label={renderText(optionInput.placeholder) || renderText(selectedOption?.label)}
            placeholder={renderText(optionInput.placeholder)}
            className="mt-2 min-h-18 resize-y"
            onValueChange={setFreeText}
          />
        )}
      </form>
    </InteractionDockShell>
  )
}
