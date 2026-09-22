import type {
  ConversationItem,
  DifyBuilderActionPayloadChange,
  DifyBuilderActionValidityChange,
  DifyBuilderActiveInteraction,
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

const firstSequence = (group: DifyBuilderConversationGroup) =>
  group.type === 'standalone' ? group.item.seq : (group.cards[0]?.seq ?? group.turn.seq)

const addLocalUserMessage = (
  groups: DifyBuilderConversationGroup[],
  items: ConversationItem[],
  message?: DifyBuilderLocalUserMessage | null,
): ConversationRenderEntry[] => {
  if (
    !message ||
    items.some(
      (item) =>
        item.kind === 'user' &&
        (message.turnId
          ? item.payload.turn_id === message.turnId
          : item.payload.text === message.text),
    )
  )
    return groups

  const entry: ConversationRenderEntry = { type: 'local-user', message }
  const insertionIndex = groups.findIndex((group) => firstSequence(group) > message.afterSequence)
  if (insertionIndex < 0) return [...groups, entry]
  return [...groups.slice(0, insertionIndex), entry, ...groups.slice(insertionIndex)]
}

export const DifyBuilderConversation = memo(
  ({
    busy,
    activeInteraction,
    viewVersion,
    activeFormId,
    interrupted,
    items,
    localUserMessage,
    onActionPayloadChange,
    onActionValidityChange,
    onActiveFormSubmit,
    onStreamingContentChange,
  }: {
    busy: boolean
    activeInteraction: DifyBuilderActiveInteraction | null
    viewVersion: number
    activeFormId?: string
    interrupted: boolean
    items: ConversationItem[]
    localUserMessage?: DifyBuilderLocalUserMessage | null
    onActionPayloadChange: DifyBuilderActionPayloadChange
    onActionValidityChange?: DifyBuilderActionValidityChange
    onActiveFormSubmit?: () => void
    onStreamingContentChange?: () => void
  }) => {
    const { t } = useTranslation()
    const groups = useMemo(() => groupConversationItems(items), [items])
    const entries = useMemo(
      () => addLocalUserMessage(groups, items, localUserMessage),
      [groups, items, localUserMessage],
    )
    const activeCard = activeInteraction?.card
    const interactionIsCurrent = activeInteraction?.valid_at_version === viewVersion

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

            if (group.type === 'standalone') {
              if (group.item.seq === activeCard?.seq) return null
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
                  key={`${group.item.seq}-${group.item.kind}`}
                  item={group.item}
                  busy={busy}
                  interactive={interactionIsCurrent && group.item.seq === activeCard?.seq}
                  invalidated={false}
                  onActionPayloadChange={onActionPayloadChange}
                  onActionValidityChange={onActionValidityChange}
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
                <ConversationCard
                  item={group.turn}
                  busy={busy}
                  interactive={interactionIsCurrent && group.turn.seq === activeCard?.seq}
                  invalidated={group.invalidated}
                  onActionPayloadChange={onActionPayloadChange}
                  onActionValidityChange={onActionValidityChange}
                />
                {group.cards
                  .filter((item) => item.seq !== activeCard?.seq)
                  .map((item) => (
                    <ConversationCard
                      key={`${item.seq}-${item.kind}`}
                      item={item}
                      busy={busy}
                      interactive={interactionIsCurrent && item.seq === activeCard?.seq}
                      invalidated={group.invalidated}
                      onActionPayloadChange={onActionPayloadChange}
                      onActionValidityChange={onActionValidityChange}
                    />
                  ))}
              </div>
            )
          })}
        </div>
        {activeCard && (
          <ConversationCard
            key={`active-${activeInteraction?.action_id}-${activeCard.seq}-${activeCard.kind}`}
            item={activeCard}
            busy={busy}
            formId={activeFormId}
            interactive={interactionIsCurrent}
            invalidated={false}
            onActionPayloadChange={onActionPayloadChange}
            onActionValidityChange={onActionValidityChange}
            onFormSubmit={onActiveFormSubmit}
          />
        )}
        <StreamingAssistantTurn busy={busy} onContentChange={onStreamingContentChange} />
      </div>
    )
  },
)
