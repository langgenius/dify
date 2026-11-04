import type {
  DifyBuilderActionPayloadChange,
  DifyBuilderActionValidityChange,
  DifyBuilderActiveInteraction,
} from '../../types'
import type { SubmitInteraction } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { useCallback, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDifyBuilderLocale } from '../../i18n/use-builder-locale'
import { useBuilderText } from '../../i18n/use-builder-text'
import { InteractionDockShell } from '../dock-shell'
import { InteractionForm } from './form'
import { getFormActionPayload, initialFormValues, prepareFormValues } from './values'

export const FormInteraction = ({
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
  const locale = useDifyBuilderLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  const formId = useId()
  const actionId = activeInteraction.action_id
  const [pending, setPending] = useState(false)
  const card = activeInteraction.card
  const { renderText } = useBuilderText()
  const submissionRef = useRef<{ payload: Record<string, unknown>; valid: boolean } | null>(null)
  if (submissionRef.current === null) {
    const fields = card.payload.fields ?? []
    const prepared = prepareFormValues(fields, initialFormValues(fields, card.payload.values))
    submissionRef.current = {
      payload: getFormActionPayload(actionId, fields, prepared.preparedValues),
      valid: prepared.valid,
    }
  }

  const handlePayloadChange = useCallback<DifyBuilderActionPayloadChange>(
    (changedActionId, nextPayload) => {
      if (changedActionId === actionId) submissionRef.current!.payload = nextPayload
    },
    [actionId],
  )
  const handleValidityChange = useCallback<DifyBuilderActionValidityChange>(
    (changedActionId, nextValid) => {
      if (changedActionId === actionId) submissionRef.current!.valid = nextValid
    },
    [actionId],
  )
  const handleSubmit = useCallback(async () => {
    const { payload, valid } = submissionRef.current!
    if (busy || pending || !valid) return
    setPending(true)
    try {
      await submitInteraction(actionId, payload)
    } finally {
      setPending(false)
    }
  }, [actionId, busy, pending, submitInteraction])

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
            : actionId === 'submit_requirements'
              ? t(($) => $['copy.actions.submitRequirements'], { ns: 'difyBuilder' })
              : t(($) => $['copy.actions.submitRules'], { ns: 'difyBuilder' })}
        </Button>
      }
    >
      <InteractionForm
        item={card}
        busy={busy || pending}
        formId={formId}
        onActionPayloadChange={handlePayloadChange}
        onActionValidityChange={handleValidityChange}
        onSubmit={handleSubmit}
      />
    </InteractionDockShell>
  )
}
