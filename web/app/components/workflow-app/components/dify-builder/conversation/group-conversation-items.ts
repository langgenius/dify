import type { DifyBuilderConversationItemResponse } from '@dify/contracts/api/console/dify-builder/types.gen'

export type DifyBuilderConversationGroup =
  | {
      type: 'standalone'
      item: DifyBuilderConversationItemResponse
      invalidated: false
    }
  | {
      type: 'assistant'
      turn: DifyBuilderConversationItemResponse
      cards: DifyBuilderConversationItemResponse[]
      invalidated: boolean
    }

export type DifyBuilderConversationGroupItem = {
  item: DifyBuilderConversationItemResponse
  invalidated: boolean
}

const STANDALONE_KINDS = new Set(['user', 'decision', 'notice'])

const readAttachedCardKinds = (turn: DifyBuilderConversationItemResponse) => {
  const cards = turn.payload.cards
  return Array.isArray(cards)
    ? cards.filter((kind): kind is string => typeof kind === 'string')
    : []
}

const hasMatchingSuffix = (
  pendingCards: DifyBuilderConversationItemResponse[],
  attachedKinds: string[],
) => {
  if (attachedKinds.length === 0 || attachedKinds.length > pendingCards.length) return false

  const offset = pendingCards.length - attachedKinds.length
  return attachedKinds.every((kind, index) => pendingCards[offset + index]?.kind === kind)
}

export const groupConversationItems = (
  items: DifyBuilderConversationItemResponse[],
): DifyBuilderConversationGroup[] => {
  const groups: DifyBuilderConversationGroup[] = []
  let pendingCards: DifyBuilderConversationItemResponse[] = []

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

  for (const item of items) {
    if (item.kind === 'assistant_turn') {
      const attachedKinds = readAttachedCardKinds(item)
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

      const attachedCardsStart = pendingCards.length - attachedKinds.length
      const attachedCards = pendingCards.slice(attachedCardsStart)
      pendingCards = pendingCards.slice(0, attachedCardsStart)
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

export const flattenConversationGroups = (
  groups: DifyBuilderConversationGroup[],
): DifyBuilderConversationGroupItem[] =>
  groups.flatMap((group) => {
    if (group.type === 'standalone') return [{ item: group.item, invalidated: false }]

    return [group.turn, ...group.cards].map((item) => ({
      item,
      invalidated: group.invalidated,
    }))
  })
