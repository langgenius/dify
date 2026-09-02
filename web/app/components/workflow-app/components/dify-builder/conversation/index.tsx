import type {
  ConversationItem,
  DifyBuilderActionPayloadChange,
  DifyBuilderActionValidityChange,
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
    changesExpanded,
    interrupted,
    items,
    onActionPayloadChange,
    onActionValidityChange,
    onStreamingContentChange,
  }: {
    busy: boolean
    changesExpanded: boolean
    interrupted: boolean
    items: ConversationItem[]
    onActionPayloadChange: DifyBuilderActionPayloadChange
    onActionValidityChange?: DifyBuilderActionValidityChange
    onStreamingContentChange?: () => void
  }) => {
    const { t } = useTranslation()
    const groups = useMemo(() => groupConversationItems(items), [items])
    const hasThinkingTurn = useMemo(
      () => items.some((item) => item.kind === 'assistant_turn' && !item.payload.reply_text),
      [items],
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
        {groups.map((group) => {
          if (group.type === 'standalone') {
            return (
              <ConversationCard
                key={`${group.item.seq}-${group.item.kind}`}
                item={group.item}
                busy={busy}
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
                changesExpanded={changesExpanded}
                invalidated={group.invalidated}
                onActionPayloadChange={onActionPayloadChange}
                onActionValidityChange={onActionValidityChange}
              />
              {group.cards.map((item) => (
                <ConversationCard
                  key={`${item.seq}-${item.kind}`}
                  item={item}
                  busy={busy}
                  changesExpanded={changesExpanded}
                  invalidated={group.invalidated}
                  onActionPayloadChange={onActionPayloadChange}
                  onActionValidityChange={onActionValidityChange}
                />
              ))}
            </div>
          )
        })}
        <StreamingAssistantTurn
          busy={busy}
          hasThinkingTurn={hasThinkingTurn}
          onContentChange={onStreamingContentChange}
        />
      </div>
    )
  },
)
