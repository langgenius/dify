import type { DifyBuilderActiveInteraction, DifyBuilderDecision } from '../types'
import type { InteractionResponseCopy } from './optimistic-response'
import type { SubmitInteraction } from './types'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { useDifyBuilderLocale } from '../i18n/use-builder-locale'
import { useBuilderText } from '../i18n/use-builder-text'
import { difyBuilderSessionViewAtom } from '../session/state'
import { ChoiceInteraction } from './choice'
import { InteractionDockShell } from './dock-shell'
import { FormInteraction } from './form'
import { ResourceInteraction } from './resource'

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
  const choiceKey = JSON.stringify([
    view?.session_id,
    view?.version,
    decision,
    view?.test_execution && [
      view.test_execution.request_id,
      view.test_execution.generation,
      view.actions?.map((action) => [action.id, action.payload]),
    ],
  ])
  const locale = useDifyBuilderLocale()
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
        context={view?.pending_fix_context}
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
