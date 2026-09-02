import type { ConversationItem } from '../types'

const findLastItem = <K extends ConversationItem['kind']>(items: ConversationItem[], kind: K) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === kind) return item as Extract<ConversationItem, { kind: K }>
  }
}

export const getDefaultActionPayload = (actionId: string, items: ConversationItem[]) => {
  if (actionId === 'submit_requirements' || actionId === 'submit_edit_rules') {
    const form = findLastItem(items, 'form')
    return form?.payload.values ?? {}
  }

  if (actionId === 'confirm_resources') {
    const resourceCard = findLastItem(items, 'resource_select')
    const selected = resourceCard?.payload.recommended?.map((resource) => resource.id) ?? []
    const policy =
      resourceCard?.payload.conflict_policy_options?.find((option) => option.recommended)?.id ??
      'ask'
    return { resource_ids: selected, conflict_policy: policy }
  }

  if (actionId === 'provide_testdata') return { mode: 'mock' }
  return {}
}

export const isClientOnlyAction = (actionId: string) => actionId === 'view_changes'
