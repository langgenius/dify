'use client'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { SubscriptionList, SubscriptionListMode } from '@/app/components/plugins/plugin-detail-panel/subscription-list'
import cn from '@/utils/classnames'
import { RiArrowDownSLine, RiWebhookLine } from '@remixicon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
          label: t('workflow.nodes.triggerPlugin.selectSubscription'),
          color: 'yellow' as const,
        }
      }
      return {
        label: 'No subscription selected',
        color: 'red' as const,
      }
    }

    return {
      label: subscriptions?.find(sub => sub.id === selectedId)?.name || '--',
      color: 'green' as const,
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
      <RiWebhookLine className='h-3.5 w-3.5 shrink-0 text-text-secondary' />
      <span className={cn('system-xs-medium truncate text-components-button-ghost-text', statusConfig.color === 'red' && 'text-components-button-destructive-secondary-text')}>
        {statusConfig.label}
      </span>
      <RiArrowDownSLine
        className={cn(
          'ml-auto h-4 w-4 shrink-0 text-text-quaternary transition-transform',
          isOpen && 'rotate-180',
        )}
      />
    </button>
  )
}

export const SubscriptionSelectorEntry = ({ selectedId, onSelect }: {
  selectedId?: string,
  onSelect: ({ id, name }: { id: string, name: string }) => void
}) => {
  const [isOpen, setIsOpen] = useState(false)

  return <PortalToFollowElem
    placement='bottom-start'
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
    <PortalToFollowElemContent className='z-[11]'>
      <div className='rounded-xl border border-components-panel-border bg-components-panel-bg shadow-lg'>
        <SubscriptionList
          mode={SubscriptionListMode.SELECTOR}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>
    </PortalToFollowElemContent>
  </PortalToFollowElem>
}
