import type {
  ConversationItem,
  DifyBuilderActionPayloadChange,
  DifyBuilderActionValidityChange,
  SessionView,
} from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ConversationCard } from './conversation-card'
import { groupConversationItems } from './group-conversation-items'
import { StreamingAssistantTurn } from './streaming-assistant-turn'

export const DifyBuilderConversation = memo(
  ({
    busy,
    activeInteraction,
    changesExpanded,
    interrupted,
    items,
    onActionPayloadChange,
    onActionValidityChange,
    onStreamingContentChange,
  }: {
    busy: boolean
    activeInteraction: SessionView['active_interaction']
    changesExpanded: boolean
    interrupted: boolean
    items: ConversationItem[]
    onActionPayloadChange: DifyBuilderActionPayloadChange
    onActionValidityChange?: DifyBuilderActionValidityChange
    onStreamingContentChange?: () => void
  }) => {
    const { t } = useTranslation()
    const groups = useMemo(() => groupConversationItems(items), [items])
    const activeCard = activeInteraction?.card

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
        {groups.map((group) => {
          if (group.type === 'standalone') {
            if (group.item.seq === activeCard?.seq) return null
            return (
              <ConversationCard
                key={`${group.item.seq}-${group.item.kind}`}
                item={group.item}
                busy={busy}
                interactive={group.item.seq === activeInteraction?.card.seq}
                changesExpanded={changesExpanded}
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
                interactive={group.turn.seq === activeInteraction?.card.seq}
                changesExpanded={changesExpanded}
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
                    interactive={item.seq === activeInteraction?.card.seq}
                    changesExpanded={changesExpanded}
                    invalidated={group.invalidated}
                    onActionPayloadChange={onActionPayloadChange}
                    onActionValidityChange={onActionValidityChange}
                  />
                ))}
            </div>
          )
        })}
        {activeCard && (
          <ConversationCard
            key={`active-${activeCard.seq}-${activeCard.kind}`}
            item={activeCard}
            busy={busy}
            interactive
            changesExpanded={changesExpanded}
            invalidated={false}
            onActionPayloadChange={onActionPayloadChange}
            onActionValidityChange={onActionValidityChange}
          />
        )}
        <StreamingAssistantTurn busy={busy} onContentChange={onStreamingContentChange} />
      </div>
    )
  },
)
