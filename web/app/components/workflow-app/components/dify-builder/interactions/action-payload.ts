import type { DifyBuilderActiveInteraction } from '../types'

export const FORM_ACTION_IDS = new Set([
  'provide_testdata',
  'submit_edit_rules',
  'submit_requirements',
])

export const getDefaultActionPayload = (
  actionId: string,
  activeInteraction: DifyBuilderActiveInteraction | null,
) => {
  const card = activeInteraction?.action_id === actionId ? activeInteraction.card : undefined
  if (actionId === 'submit_requirements' || actionId === 'submit_edit_rules') {
    return card?.kind === 'form' ? (card.payload.values ?? {}) : {}
  }

  if (actionId === 'confirm_resources') {
    const selected =
      card?.kind === 'resource_select'
        ? (card.payload.recommended?.map((resource) => resource.id) ?? [])
        : []
    return { resource_ids: selected }
  }

  if (actionId === 'provide_testdata')
    return { mode: 'provide', inputs: card?.kind === 'form' ? (card.payload.values ?? {}) : {} }
  return {}
}
