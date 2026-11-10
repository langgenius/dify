import type { DifyBuilderActiveInteraction } from '../../types'
import type { SubmitInteraction } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDifyBuilderLocale } from '../../i18n/use-builder-locale'
import { useBuilderText } from '../../i18n/use-builder-text'
import { getDefaultActionPayload } from '../action-payload'
import { InteractionDockShell } from '../dock-shell'
import { ResourcePicker } from './picker'

export const ResourceInteraction = ({
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
  const locale = useDifyBuilderLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  const formId = useId()
  const actionId = activeInteraction.action_id
  const payloadRef = useRef<Record<string, unknown> | null>(null)
  if (payloadRef.current === null) {
    payloadRef.current = getDefaultActionPayload(actionId, activeInteraction)
  }
  const [pending, setPending] = useState(false)
  const card = activeInteraction.card
  const { renderText } = useBuilderText()

  const handleSubmit = async () => {
    if (busy || pending) return
    setPending(true)
    try {
      await submitInteraction(actionId, payloadRef.current!)
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
          {t(($) => $['copy.actions.confirmResources'], { ns: 'difyBuilder' })}
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
        <ResourcePicker
          item={card}
          busy={busy || pending}
          onActionPayloadChange={(changedActionId, nextPayload) => {
            if (changedActionId === actionId) payloadRef.current = nextPayload
          }}
        />
      </form>
    </InteractionDockShell>
  )
}
