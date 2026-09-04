import type { SessionView } from '../types'

export const getDefaultActionPayload = (
  actionId: string,
  activeInteraction: SessionView['active_interaction'],
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
    const policy =
      (card?.kind === 'resource_select'
        ? card.payload.conflict_policy_options?.find((option) => option.recommended)?.id
        : undefined) ?? 'ask'
    return { resource_ids: selected, conflict_policy: policy }
  }

  if (actionId === 'provide_testdata') return { mode: 'mock' }
  return {}
}

export const isClientOnlyAction = (actionId: string) => actionId === 'view_changes'
