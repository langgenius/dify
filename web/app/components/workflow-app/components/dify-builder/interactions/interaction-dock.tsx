import type { ReactNode } from 'react'
import type { DifyBuilderActiveInteraction, DifyBuilderDecision, SessionView } from '../types'
import type { InteractionResponseCopy } from './optimistic-response'
import { Button } from '@langgenius/dify-ui/button'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useAtomValue } from 'jotai'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormCard } from '../conversation/form-card'
import { ResourceCard } from '../conversation/resource-card'
import { useBuilderText } from '../copy/use-builder-text'
import { difyBuilderSessionViewAtom } from '../session/state'
import { getDefaultActionPayload } from './action-payload'
import { useDifyBuilderInteractionLocale } from './use-interaction-locale'

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
  const locale = useDifyBuilderInteractionLocale()

  return (
    <section
      aria-labelledby={titleId}
      lang={locale}
      className="mx-4 flex max-h-[min(60vh,26rem)] flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[10px]"
    >
      <header className="shrink-0 px-4 pt-4 pb-3">
        <h2 id={titleId} className="system-sm-semibold text-text-primary">
          {title}
        </h2>
        {description && <p className="mt-1 system-xs-regular text-text-tertiary">{description}</p>}
      </header>
      {children ? <div className="min-h-0 overflow-y-auto px-4 pb-3">{children}</div> : null}
      {footer ? <div className="flex shrink-0 justify-end px-4 py-4">{footer}</div> : null}
    </section>
  )
}

const ChoiceInteraction = ({
  actions,
  busy,
  decision,
  recheckReady,
  submitInteraction,
}: {
  actions: SessionView['actions']
  busy: boolean
  decision: DifyBuilderDecision
  recheckReady: boolean
  submitInteraction: SubmitInteraction
}) => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  const formId = useId()
  const options = decision.options ?? []
  const { renderText } = useBuilderText()
  const title = renderText(decision.title)
  const requiresConsent = options.some((option) => option.id === 'confirm_test_operation')
  const [selectedId, setSelectedId] = useState(
    requiresConsent ? '' : decision.default_option_id || options[0]?.id || '',
  )
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
      description={renderText(decision.description)}
      footer={
        <Button
          type="submit"
          form={formId}
          size="small"
          variant="primary"
          loading={pending}
          disabled={pending ? false : busy || !canSubmit}
        >
          {renderText(decision.submit?.label) || t(($) => $['operation.submit'], { ns: 'common' })}
        </Button>
      }
    >
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
              className="flex min-h-9 w-full cursor-pointer items-center rounded-[10px] border border-transparent bg-background-section px-3 py-2.5 text-left system-sm-medium text-text-secondary outline-hidden transition-colors hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-state-accent-solid/30 data-checked:bg-util-colors-blue-brand-blue-brand-50 data-checked:text-text-primary data-checked:hover:border-state-accent-solid/30 data-checked:hover:bg-util-colors-blue-brand-blue-brand-50 data-disabled:cursor-not-allowed data-disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block">{renderText(option.label)}</span>
                {option.description && (
                  <span className="mt-0.5 block system-xs-regular text-text-tertiary">
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
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  const formId = useId()
  const actionId = activeInteraction.action_id
  const [payload, setPayload] = useState<Record<string, unknown>>(() =>
    getDefaultActionPayload(actionId, activeInteraction),
  )
  const [valid, setValid] = useState(false)
  const [pending, setPending] = useState(false)
  const card = activeInteraction.card
  const { renderText } = useBuilderText()

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
      title={
        renderText(card.payload.title) || t(($) => $['cardCategory.form'], { ns: 'difyBuilder' })
      }
      description={renderText(card.payload.description)}
      footer={
        <Button
          type="submit"
          form={formId}
          size="small"
          variant="primary"
          loading={pending}
          disabled={pending ? false : busy}
        >
          {actionId === 'provide_testdata'
            ? t(($) => $.runTest, { ns: 'difyBuilder' })
            : t(($) => $['operation.submit'], { ns: 'common' })}
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
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  const formId = useId()
  const actionId = activeInteraction.action_id
  const [payload, setPayload] = useState<Record<string, unknown>>(() =>
    getDefaultActionPayload(actionId, activeInteraction),
  )
  const [pending, setPending] = useState(false)
  const card = activeInteraction.card
  const { renderText } = useBuilderText()

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
        renderText(card.payload.title) ||
        t(($) => $['cardCategory.resources'], { ns: 'difyBuilder' })
      }
      description={renderText(card.payload.description)}
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
  submitInteraction: (
    actionId: string,
    payload: Record<string, unknown>,
    copy: InteractionResponseCopy,
  ) => Promise<boolean>
}) => {
  const view = useAtomValue(difyBuilderSessionViewAtom)
  const choiceKey = view?.test_execution
    ? JSON.stringify([
        view.test_execution.request_id,
        view.test_execution.generation,
        view.actions?.map((action) => [action.id, action.payload]),
      ])
    : 'choice'
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  const { renderText } = useBuilderText()
  const submitWithResponseCopy: SubmitInteraction = (actionId, payload = {}) =>
    submitInteraction(actionId, payload, {
      renderText,
      replyLanguage: locale,
      booleanFalse: t(($) => $['interactionResponse.booleanFalse'], { ns: 'difyBuilder' }),
      booleanTrue: t(($) => $['interactionResponse.booleanTrue'], { ns: 'difyBuilder' }),
      noResourcesSelected: t(($) => $['interactionResponse.noResourcesSelected'], {
        ns: 'difyBuilder',
      }),
    })

  if (activeInteraction?.card.kind === 'form') {
    return (
      <FormInteraction
        activeInteraction={{ ...activeInteraction, card: activeInteraction.card }}
        busy={busy}
        submitInteraction={submitWithResponseCopy}
      />
    )
  }

  if (activeInteraction?.card.kind === 'resource_select') {
    return (
      <ResourceInteraction
        activeInteraction={{ ...activeInteraction, card: activeInteraction.card }}
        busy={busy}
        submitInteraction={submitWithResponseCopy}
      />
    )
  }

  if (decision) {
    return (
      <ChoiceInteraction
        key={choiceKey}
        actions={view?.actions}
        busy={busy}
        decision={decision}
        recheckReady={recheckReady}
        submitInteraction={submitWithResponseCopy}
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
