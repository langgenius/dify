import type { ConversationItem } from '../types'

export type DifyBuilderConversationGroup =
  | { type: 'standalone'; item: ConversationItem; invalidated: false }
  | {
      type: 'assistant'
      turn: Extract<ConversationItem, { kind: 'assistant_turn' }>
      cards: ConversationItem[]
      invalidated: boolean
    }

const STANDALONE_KINDS = new Set<ConversationItem['kind']>([
  'user',
  'decision',
  'interaction_response',
  'notice',
])

const hasMatchingSuffix = (pendingCards: ConversationItem[], attachedKinds: string[]) => {
  if (attachedKinds.length === 0 || attachedKinds.length > pendingCards.length) return false
  const offset = pendingCards.length - attachedKinds.length
  return attachedKinds.every((kind, index) => pendingCards[offset + index]?.kind === kind)
}

export const groupConversationItems = (
  items: ConversationItem[],
): DifyBuilderConversationGroup[] => {
  const groups: DifyBuilderConversationGroup[] = []
  let pendingCards: ConversationItem[] = []
  // A handler can allocate its output before the runner appends the durable
  // response. They share one CAS version, so present the user's submission
  // first even when its storage sequence is later.
  const orderedItems = [...items].sort((left, right) => {
    if (left.at_version === right.at_version) {
      const responseOrder =
        Number(right.kind === 'interaction_response') - Number(left.kind === 'interaction_response')
      if (responseOrder !== 0) return responseOrder
    }
    return left.seq - right.seq
  })

  const flushPendingCards = () => {
    groups.push(
      ...pendingCards.map((item): DifyBuilderConversationGroup => ({
        type: 'standalone',
        item,
        invalidated: false,
      })),
    )
    pendingCards = []
  }

  for (const item of orderedItems) {
    if (item.kind === 'assistant_turn') {
      const attachedKinds = item.payload.cards ?? []
      if (!hasMatchingSuffix(pendingCards, attachedKinds)) {
        flushPendingCards()
        groups.push({
          type: 'assistant',
          turn: item,
          cards: [],
          invalidated: item.payload.card_state === 'invalidated',
        })
        continue
      }

      const cardsStart = pendingCards.length - attachedKinds.length
      const attachedCards = pendingCards.slice(cardsStart)
      pendingCards = pendingCards.slice(0, cardsStart)
      flushPendingCards()
      groups.push({
        type: 'assistant',
        turn: item,
        cards: attachedCards,
        invalidated: item.payload.card_state === 'invalidated',
      })
      continue
    }

    if (STANDALONE_KINDS.has(item.kind)) {
      flushPendingCards()
      groups.push({ type: 'standalone', item, invalidated: false })
      continue
    }

    pendingCards.push(item)
  }

  flushPendingCards()
  return groups
}
