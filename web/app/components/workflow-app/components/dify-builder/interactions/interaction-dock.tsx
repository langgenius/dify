import type { ReactNode } from 'react'
import type { DifyBuilderActiveInteraction, DifyBuilderDecision } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioControl, RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormCard } from '../conversation/form-card'
import { ResourceCard } from '../conversation/resource-card'
import { getDefaultActionPayload } from './action-payload'

type SubmitInteraction = (actionId: string, payload?: Record<string, unknown>) => Promise<boolean>

const InteractionDockShell = ({
  children,
  description,
  footer,
  title,
}: {
  children?: ReactNode
  description?: string
  footer?: ReactNode
  title: string
}) => {
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className="mx-4 flex max-h-[min(60vh,26rem)] flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[10px]"
    >
      <header className="shrink-0 px-4 pt-4 pb-3">
        <h2 id={titleId} className="system-sm-semibold text-text-primary">
          {title}
        </h2>
        {description && <p className="mt-1 system-xs-regular text-text-tertiary">{description}</p>}
      </header>
      {children && <div className="min-h-0 overflow-y-auto px-4 pb-3">{children}</div>}
      {footer && <div className="flex shrink-0 justify-end px-4 py-4">{footer}</div>}
    </section>
  )
}

const ChoiceInteraction = ({
  busy,
  decision,
  recheckReady,
  submitInteraction,
}: {
  busy: boolean
  decision: DifyBuilderDecision
  recheckReady: boolean
  submitInteraction: SubmitInteraction
}) => {
  const { t } = useTranslation(['common'])
  const formId = useId()
  const options = decision.options ?? []
  const [selectedId, setSelectedId] = useState(decision.default_option_id || options[0]?.id || '')
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
        option_id: selectedId,
        ...(optionInput && trimmedFreeText ? { free_text: trimmedFreeText } : {}),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <InteractionDockShell
      title={decision.title}
      description={decision.description}
      footer={
        <Button
          type="submit"
          form={formId}
          size="small"
          variant="primary"
          loading={pending}
          disabled={pending ? false : busy || !canSubmit}
        >
          {t(($) => $['operation.submit'], { ns: 'common' })}
        </Button>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <RadioGroup
          aria-label={decision.title}
          className="flex-col items-stretch gap-2"
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
              className={(state) =>
                cn(
                  'flex min-h-9 w-full items-center gap-2 rounded-[10px] border-[0.5px] px-3 py-2 text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                  state.checked
                    ? 'border-state-accent-solid bg-state-accent-hover'
                    : 'border-components-option-card-option-border bg-background-section hover:bg-state-base-hover',
                )
              }
            >
              <RadioControl />
              <span className="min-w-0 flex-1">
                <span className="block system-sm-medium text-text-primary">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block system-xs-regular text-text-tertiary">
                    {option.description}
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
            aria-label={optionInput.placeholder || selectedOption?.label}
            placeholder={optionInput.placeholder}
            className="mt-2 min-h-18 resize-y"
            onValueChange={setFreeText}
          />
        )}
      </form>
    </InteractionDockShell>
  )
}

const FormInteraction = ({
  activeInteraction,
  busy,
  submitInteraction,
}: {
  activeInteraction: DifyBuilderActiveInteraction & {
    card: Extract<DifyBuilderActiveInteraction['card'], { kind: 'form' }>
  }
  busy: boolean
  submitInteraction: SubmitInteraction
}) => {
  const { t } = useTranslation(['workflow', 'common'])
  const formId = useId()
  const actionId = activeInteraction.action_id
  const [payload, setPayload] = useState<Record<string, unknown>>(() =>
    getDefaultActionPayload(actionId, activeInteraction),
  )
  const [valid, setValid] = useState(false)
  const [pending, setPending] = useState(false)
  const card = activeInteraction.card

  const handleSubmit = async () => {
    if (busy || pending || !valid) return
    setPending(true)
    try {
      await submitInteraction(actionId, payload)
    } finally {
      setPending(false)
    }
  }

  return (
    <InteractionDockShell
      title={card.payload.title || t(($) => $['difyBuilder.cardCategory.form'], { ns: 'workflow' })}
      description={card.payload.description}
      footer={
        <Button
          type="submit"
          form={formId}
          size="small"
          variant="primary"
          loading={pending}
          disabled={pending ? false : busy}
        >
          {t(($) => $['operation.submit'], { ns: 'common' })}
        </Button>
      }
    >
      <FormCard
        item={card}
        busy={busy || pending}
        formId={formId}
        onActionPayloadChange={(changedActionId, nextPayload) => {
          if (changedActionId === actionId) setPayload(nextPayload)
        }}
        onActionValidityChange={(changedActionId, nextValid) => {
          if (changedActionId === actionId) setValid(nextValid)
        }}
        onSubmit={() => void handleSubmit()}
      />
    </InteractionDockShell>
  )
}

const ResourceInteraction = ({
  activeInteraction,
  busy,
  submitInteraction,
}: {
  activeInteraction: DifyBuilderActiveInteraction & {
    card: Extract<DifyBuilderActiveInteraction['card'], { kind: 'resource_select' }>
  }
  busy: boolean
  submitInteraction: SubmitInteraction
}) => {
  const { t } = useTranslation(['workflow', 'common'])
  const formId = useId()
  const actionId = activeInteraction.action_id
  const [payload, setPayload] = useState<Record<string, unknown>>(() =>
    getDefaultActionPayload(actionId, activeInteraction),
  )
  const [pending, setPending] = useState(false)
  const card = activeInteraction.card

  const handleSubmit = async () => {
    if (busy || pending) return
    setPending(true)
    try {
      await submitInteraction(actionId, payload)
    } finally {
      setPending(false)
    }
  }

  return (
    <InteractionDockShell
      title={
        card.payload.title || t(($) => $['difyBuilder.cardCategory.resources'], { ns: 'workflow' })
      }
      description={card.payload.description}
      footer={
        <Button
          type="submit"
          form={formId}
          size="small"
          variant="primary"
          loading={pending}
          disabled={pending ? false : busy}
        >
          {t(($) => $['operation.submit'], { ns: 'common' })}
        </Button>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <ResourceCard
          item={card}
          busy={busy || pending}
          onActionPayloadChange={(changedActionId, nextPayload) => {
            if (changedActionId === actionId) setPayload(nextPayload)
          }}
        />
      </form>
    </InteractionDockShell>
  )
}

export const DifyBuilderInteractionDock = ({
  activeInteraction,
  busy,
  decision,
  interactionPending,
  recheckReady,
  submitInteraction,
}: {
  activeInteraction: DifyBuilderActiveInteraction | null
  busy: boolean
  decision: DifyBuilderDecision | null
  interactionPending: boolean
  recheckReady: boolean
  submitInteraction: SubmitInteraction
}) => {
  const { t } = useTranslation(['common'])

  if (activeInteraction?.card.kind === 'form') {
    return (
      <FormInteraction
        activeInteraction={{ ...activeInteraction, card: activeInteraction.card }}
        busy={busy}
        submitInteraction={submitInteraction}
      />
    )
  }

  if (activeInteraction?.card.kind === 'resource_select') {
    return (
      <ResourceInteraction
        activeInteraction={{ ...activeInteraction, card: activeInteraction.card }}
        busy={busy}
        submitInteraction={submitInteraction}
      />
    )
  }

  if (decision) {
    return (
      <ChoiceInteraction
        busy={busy}
        decision={decision}
        recheckReady={recheckReady}
        submitInteraction={submitInteraction}
      />
    )
  }

  if (interactionPending) {
    return (
      <InteractionDockShell title={t(($) => $.loading, { ns: 'common' })}>
        <div className="h-20 animate-pulse rounded-lg bg-background-section motion-reduce:animate-none" />
      </InteractionDockShell>
    )
  }

  return null
}
