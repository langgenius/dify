import type { ConversationItem, DifyBuilderActiveInteraction, DifyBuilderDecision } from '../types'

type InteractionResponsePayload = Extract<
  ConversationItem,
  { kind: 'interaction_response' }
>['payload']
type FormInteraction = DifyBuilderActiveInteraction & {
  card: Extract<ConversationItem, { kind: 'form' }>
}
type ResourceInteraction = DifyBuilderActiveInteraction & {
  card: Extract<ConversationItem, { kind: 'resource_select' }>
}

// Mirror the persisted response formatter so the optimistic card does not
// change copy when the authoritative conversation item replaces it.
const displayInteractionValue = (value: unknown): string => {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value))
    return value.map(displayInteractionValue).filter(Boolean).join(', ') || '—'
  if (typeof value === 'object') {
    const namedValue = value as { filename?: unknown; name?: unknown }
    const name = namedValue.name || namedValue.filename
    if (typeof name === 'string' && name) return name
    return JSON.stringify(value)
  }
  return String(value)
}

const choiceResponse = (
  decision: DifyBuilderDecision | null,
  payload: Record<string, unknown>,
): InteractionResponsePayload | null => {
  if (!decision || typeof payload.option_id !== 'string') return null
  const option = decision.options?.find((candidate) => candidate.id === payload.option_id)
  if (!option) return null

  const freeText = typeof payload.free_text === 'string' ? payload.free_text.trim() : ''
  return {
    interaction_kind: 'choice',
    question: decision.title,
    answer: freeText ? `${option.label} — ${freeText}` : option.label,
    submitted_data: {
      option_id: option.id,
      ...(freeText ? { free_text: freeText } : {}),
    },
  }
}

const resourceResponse = (
  activeInteraction: ResourceInteraction,
  payload: Record<string, unknown>,
): InteractionResponsePayload | null => {
  if (!activeInteraction.card.payload.title) return null
  const selectedIds = Array.isArray(payload.resource_ids)
    ? payload.resource_ids.filter((value): value is string => typeof value === 'string')
    : []
  const selectedIdSet = new Set(selectedIds)
  const selectedLabels = (activeInteraction.card.payload.recommended ?? [])
    .filter((resource) => selectedIdSet.has(resource.id))
    .map((resource) => resource.label || resource.id)

  return {
    interaction_kind: 'resource',
    question: activeInteraction.card.payload.title,
    answer: selectedLabels.join(', ') || 'No resources selected',
    submitted_data: { resource_ids: selectedIds },
  }
}

const formResponse = (
  actionId: string,
  activeInteraction: FormInteraction,
  payload: Record<string, unknown>,
): InteractionResponsePayload | null => {
  const card = activeInteraction.card
  if (!card.payload.title) return null
  const submittedValues =
    actionId === 'provide_testdata' && payload.inputs && typeof payload.inputs === 'object'
      ? (payload.inputs as Record<string, unknown>)
      : payload
  const submittedData: Record<string, unknown> = {}
  const fields = (card.payload.fields ?? []).map((field) => {
    const value = field.key in submittedValues ? submittedValues[field.key] : null
    submittedData[field.key] = value
    return {
      key: field.key,
      label: field.label || field.key,
      value,
      display_value: displayInteractionValue(value),
    }
  })

  return {
    interaction_kind: 'form',
    question: card.payload.title,
    fields,
    submitted_data: submittedData,
  }
}

export const createOptimisticInteractionResponse = ({
  actionId,
  activeInteraction,
  decision,
  payload,
}: {
  actionId: string
  activeInteraction: DifyBuilderActiveInteraction | null
  decision: DifyBuilderDecision | null
  payload: Record<string, unknown>
}): InteractionResponsePayload | null => {
  if (actionId === 'confirm') return choiceResponse(decision, payload)
  if (!activeInteraction || activeInteraction.action_id !== actionId) return null
  if (activeInteraction.card.kind === 'resource_select')
    return resourceResponse({ ...activeInteraction, card: activeInteraction.card }, payload)
  if (activeInteraction.card.kind === 'form')
    return formResponse(actionId, { ...activeInteraction, card: activeInteraction.card }, payload)
  return null
}
