import type {
  DifyBuilderActionResponse,
  DifyBuilderConversationItemResponse,
} from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderConversationGroup } from '../conversation/group-conversation-items'
import { flattenConversationGroups } from '../conversation/group-conversation-items'

type ActionPayloadSource = 'provided' | 'checklist' | 'mock-test-data'

type ActionPolicy = {
  ownerKinds: readonly string[]
  requireOwner?: boolean
  clientOnly?: boolean
  payloadSource?: ActionPayloadSource
}

const REVIEW_OWNER_KINDS = ['summary', 'change_set', 'error', 'test_result', 'plan'] as const
const REPAIR_OWNER_KINDS = ['change_set', 'error', 'plan', 'summary'] as const

const ACTION_POLICIES: Record<string, ActionPolicy> = {
  accept_learning: { ownerKinds: ['build_learning'], requireOwner: true },
  approve_plan: { ownerKinds: REPAIR_OWNER_KINDS },
  confirm_resources: { ownerKinds: ['resource_select'], requireOwner: true },
  continue_adjusting: { ownerKinds: REVIEW_OWNER_KINDS },
  find_resources: { ownerKinds: ['plan'], requireOwner: true },
  keep_draft: { ownerKinds: REVIEW_OWNER_KINDS },
  provide_testdata: {
    ownerKinds: ['error', 'test_result', 'summary', 'run_context'],
    payloadSource: 'mock-test-data',
  },
  publish_fix: { ownerKinds: REVIEW_OWNER_KINDS },
  publish_workflow: { ownerKinds: REVIEW_OWNER_KINDS },
  recheck: { ownerKinds: ['plan', 'preflight_context'], payloadSource: 'checklist' },
  reject_repair: { ownerKinds: REPAIR_OWNER_KINDS },
  retry_after_revert: { ownerKinds: ['notice', 'plan', 'checkpoint'] },
  revert: { ownerKinds: REVIEW_OWNER_KINDS },
  run_affected_tests: { ownerKinds: ['plan', 'change_set'] },
  run_test: { ownerKinds: ['plan', 'change_set'] },
  run_validation: { ownerKinds: ['change_set', 'plan'] },
  send_edit_goal: { ownerKinds: ['user', 'assistant_turn'] },
  send_goal: { ownerKinds: ['user', 'assistant_turn'] },
  skip_learning: { ownerKinds: ['build_learning'], requireOwner: true },
  submit_edit_rules: { ownerKinds: ['form'], requireOwner: true },
  submit_requirements: { ownerKinds: ['form'], requireOwner: true },
  view_changes: { ownerKinds: ['change_set'], requireOwner: true, clientOnly: true },
}

const findLastItem = (
  items: DifyBuilderConversationItemResponse[],
  predicate: (item: DifyBuilderConversationItemResponse) => boolean,
) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item && predicate(item)) return item
  }
}

const findFallbackOwner = (items: DifyBuilderConversationItemResponse[]) =>
  findLastItem(items, (item) => !['user', 'decision', 'notice'].includes(item.kind)) ?? items.at(-1)

export const placeConversationActions = (
  groups: DifyBuilderConversationGroup[],
  actions: DifyBuilderActionResponse[],
) => {
  const liveItems = flattenConversationGroups(groups)
    .filter(({ invalidated }) => !invalidated)
    .map(({ item }) => item)
  const placements = new Map<number, DifyBuilderActionResponse[]>()

  for (const action of actions) {
    if (action.kind === 'automatic') continue
    const policy = ACTION_POLICIES[action.id]
    const owner = policy
      ? (findLastItem(liveItems, (item) => policy.ownerKinds.includes(item.kind)) ??
        (policy.requireOwner ? undefined : findFallbackOwner(liveItems)))
      : findFallbackOwner(liveItems)
    if (!owner) continue

    placements.set(owner.seq, [...(placements.get(owner.seq) ?? []), action])
  }

  return placements
}

export const isClientOnlyAction = (actionId: string) =>
  ACTION_POLICIES[actionId]?.clientOnly === true

export const resolveActionPayload = (
  actionId: string,
  providedPayload: Record<string, unknown>,
  checklistPayload: Record<string, unknown>,
) => {
  const payloadSource = ACTION_POLICIES[actionId]?.payloadSource ?? 'provided'
  if (payloadSource === 'checklist') return checklistPayload
  if (payloadSource === 'mock-test-data' && Object.keys(providedPayload).length === 0)
    return { mode: 'mock' }
  return providedPayload
}
