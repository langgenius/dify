import type {
  ConversationItem,
  DifyBuilderLocalInteractionResponse,
  DifyBuilderLocalUserMessage,
} from '../types'
import type { DifyBuilderConversationGroup } from './group-conversation-items'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ConversationCard, UserMessage } from './conversation-card'
import { groupConversationItems } from './group-conversation-items'
import { StreamingAssistantTurn } from './streaming-assistant-turn'

type ConversationRenderEntry =
  | DifyBuilderConversationGroup
  | { type: 'local-user'; message: DifyBuilderLocalUserMessage }
  | { type: 'local-interaction'; response: DifyBuilderLocalInteractionResponse }

const firstSequence = (group: DifyBuilderConversationGroup) =>
  group.type === 'standalone' ? group.item.seq : (group.cards[0]?.seq ?? group.turn.seq)

const insertLocalEntry = (
  entries: ConversationRenderEntry[],
  entry: ConversationRenderEntry,
  afterSequence: number,
) => {
  const insertionIndex = entries.findIndex(
    (candidate) =>
      candidate.type !== 'local-user' &&
      candidate.type !== 'local-interaction' &&
      firstSequence(candidate) > afterSequence,
  )
  if (insertionIndex < 0) return [...entries, entry]
  return [...entries.slice(0, insertionIndex), entry, ...entries.slice(insertionIndex)]
}

const addLocalEntries = (
  groups: DifyBuilderConversationGroup[],
  items: ConversationItem[],
  message?: DifyBuilderLocalUserMessage | null,
  interactionResponse?: DifyBuilderLocalInteractionResponse | null,
): ConversationRenderEntry[] => {
  let entries: ConversationRenderEntry[] = [...groups]
  if (
    message &&
    !items.some(
      (item) =>
        item.kind === 'user' &&
        (message.turnId
          ? item.payload.turn_id === message.turnId
          : item.payload.text === message.text),
    )
  )
    entries = insertLocalEntry(entries, { type: 'local-user', message }, message.afterSequence)
  if (
    interactionResponse &&
    !items.some(
      (item) =>
        item.kind === 'interaction_response' &&
        item.at_version === interactionResponse.item.at_version,
    )
  )
    entries = insertLocalEntry(
      entries,
      { type: 'local-interaction', response: interactionResponse },
      interactionResponse.afterSequence,
    )
  return entries
}

export const DifyBuilderConversation = memo(
  ({
    busy,
    interrupted,
    items,
    localInteractionResponse,
    localUserMessage,
    onStreamingContentChange,
  }: {
    busy: boolean
    interrupted: boolean
    items: ConversationItem[]
    localInteractionResponse?: DifyBuilderLocalInteractionResponse | null
    localUserMessage?: DifyBuilderLocalUserMessage | null
    onStreamingContentChange?: () => void
  }) => {
    const { t } = useTranslation()
    const groups = useMemo(() => groupConversationItems(items), [items])
    const entries = useMemo(
      () => addLocalEntries(groups, items, localUserMessage, localInteractionResponse),
      [groups, items, localInteractionResponse, localUserMessage],
    )
    return (
      <div className="flex flex-col gap-3 px-4 py-4">
        {interrupted && (
          <div
            role="alert"
            className="rounded-lg bg-state-warning-hover px-3 py-2 system-xs-regular text-text-warning"
          >
            {t(($) => $['difyBuilder.interrupted'], { ns: 'workflow' })}
          </div>
        )}
        <div
          role="log"
          aria-label={t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}
          aria-live="polite"
          aria-relevant="additions"
          className="flex flex-col gap-3"
        >
          {entries.map((group) => {
            if (group.type === 'local-user') {
              return <UserMessage key={`user-${group.message.localId}`} text={group.message.text} />
            }

            if (group.type === 'local-interaction') {
              return (
                <ConversationCard
                  key={`interaction-${group.response.item.at_version}`}
                  item={group.response.item}
                  invalidated={false}
                />
              )
            }

            if (group.type === 'standalone') {
              if (group.item.kind === 'user') {
                return (
                  <UserMessage
                    key={`user-${group.item.payload.turn_id}`}
                    text={group.item.payload.text}
                  />
                )
              }
              return (
                <ConversationCard
                  key={
                    group.item.kind === 'interaction_response'
                      ? `interaction-${group.item.at_version}`
                      : `${group.item.seq}-${group.item.kind}`
                  }
                  item={group.item}
                  invalidated={false}
                />
              )
            }

            return (
              <div
                key={`${group.turn.seq}-${group.turn.kind}`}
                className={cn('flex flex-col gap-3', group.invalidated && 'opacity-70')}
              >
                {group.invalidated && (
                  <div className="flex items-center gap-1.5 px-1 system-2xs-medium-uppercase text-text-tertiary">
                    <span aria-hidden className="i-ri-history-line size-3.5" />
                    <span>{t(($) => $['difyBuilder.invalidated'], { ns: 'workflow' })}</span>
                  </div>
                )}
                <ConversationCard item={group.turn} invalidated={group.invalidated} />
                {group.cards.map((item) => (
                  <ConversationCard
                    key={`${item.seq}-${item.kind}`}
                    item={item}
                    invalidated={group.invalidated}
                  />
                ))}
              </div>
            )
          })}
        </div>
        <StreamingAssistantTurn busy={busy} onContentChange={onStreamingContentChange} />
      </div>
    )
  },
)
