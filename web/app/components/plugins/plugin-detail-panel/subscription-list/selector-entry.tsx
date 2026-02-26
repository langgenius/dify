'use client'
import type { SimpleSubscription } from './types'
import { RiArrowDownSLine, RiWebhookLine } from '@remixicon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { SubscriptionList } from '@/app/components/plugins/plugin-detail-panel/subscription-list'
import { cn } from '@/utils/classnames'
import { SubscriptionListMode } from './types'
import { useSubscriptionList } from './use-subscription-list'

type SubscriptionTriggerButtonProps = {
  selectedId?: string
  onClick?: () => void
  isOpen?: boolean
  className?: string
}

const SubscriptionTriggerButton: React.FC<SubscriptionTriggerButtonProps> = ({
  selectedId,
  onClick,
  isOpen = false,
  className,
}) => {
  const { t } = useTranslation()
  const { subscriptions } = useSubscriptionList()

  const statusConfig = useMemo(() => {
    if (!selectedId) {
      if (isOpen) {
        return {
          label: t('subscription.selectPlaceholder', { ns: 'pluginTrigger' }),
          color: 'yellow' as const,
        }
      }
      return {
        label: t('subscription.noSubscriptionSelected', { ns: 'pluginTrigger' }),
        color: 'red' as const,
      }
    }

    if (subscriptions && subscriptions.length > 0) {
      const selectedSubscription = subscriptions?.find(sub => sub.id === selectedId)

      if (!selectedSubscription) {
        return {
          label: t('subscription.subscriptionRemoved', { ns: 'pluginTrigger' }),
          color: 'red' as const,
        }
      }

      return {
        label: selectedSubscription.name,
        color: 'green' as const,
      }
    }

    return {
      label: t('subscription.noSubscriptionSelected', { ns: 'pluginTrigger' }),
      color: 'red' as const,
    }
  }, [selectedId, subscriptions, t, isOpen])

  return (
    <button
      className={cn(
        'flex h-8 items-center gap-1 rounded-lg px-2 transition-colors',
        'hover:bg-state-base-hover-alt',
        isOpen && 'bg-state-base-hover-alt',
        className,
      )}
      onClick={onClick}
    >
      <RiWebhookLine className={cn('h-3.5 w-3.5 shrink-0 text-text-secondary', statusConfig.color === 'red' && 'text-components-button-destructive-secondary-text')} />
      <span className={cn('system-xs-medium truncate text-components-button-ghost-text', statusConfig.color === 'red' && 'text-components-button-destructive-secondary-text')}>
        {statusConfig.label}
      </span>
      <RiArrowDownSLine
        className={cn(
          'ml-auto h-4 w-4 shrink-0 text-text-quaternary transition-transform',
          isOpen && 'rotate-180',
          statusConfig.color === 'red' && 'text-components-button-destructive-secondary-text',
        )}
      />
    </button>
  )
}

export const SubscriptionSelectorEntry = ({ selectedId, onSelect }: {
  selectedId?: string
  onSelect: (v: SimpleSubscription, callback?: () => void) => void
}) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <PortalToFollowElem
      placement="bottom-start"
      offset={4}
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <PortalToFollowElemTrigger asChild>
        <div>
          <SubscriptionTriggerButton
            selectedId={selectedId}
            onClick={() => setIsOpen(!isOpen)}
            isOpen={isOpen}
          />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[11]">
        <div className="rounded-xl border border-components-panel-border bg-components-panel-bg shadow-lg">
          <SubscriptionList
            mode={SubscriptionListMode.SELECTOR}
            selectedId={selectedId}
            onSelect={(...args) => {
              onSelect(...args)
              setIsOpen(false)
            }}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
