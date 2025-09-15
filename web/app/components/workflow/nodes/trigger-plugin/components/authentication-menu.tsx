'use client'

import type { FC } from 'react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine, RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import cn from '@/utils/classnames'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'

export type AuthenticationStatus = 'authorized' | 'not_configured' | 'error'

export type AuthSubscription = {
  id: string
  name: string
  status: AuthenticationStatus
  credentials?: Record<string, any>
}

type AuthenticationMenuProps = {
  subscriptions: TriggerSubscription[]
  selectedSubscriptionId?: string
  onSubscriptionSelect: (subscriptionId: string) => void
  onConfigure: () => void
  onRemove: (subscriptionId: string) => void
  className?: string
}

const AuthenticationMenu: FC<AuthenticationMenuProps> = ({
  subscriptions,
  selectedSubscriptionId,
  onSubscriptionSelect,
  onConfigure,
  onRemove,
  className,
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  const selectedSubscription = useMemo(() => {
    return subscriptions.find(sub => sub.id === selectedSubscriptionId)
  }, [subscriptions, selectedSubscriptionId])

  const getStatusConfig = useCallback(() => {
    if (!selectedSubscription) {
      if (subscriptions.length > 0) {
        return {
          label: t('workflow.nodes.triggerPlugin.selectSubscription'),
          color: 'yellow' as const,
        }
      }
      return {
        label: t('workflow.nodes.triggerPlugin.notConfigured'),
        color: 'red' as const,
      }
    }

    // Check if subscription is authorized based on credential_type
    const isAuthorized = selectedSubscription.credential_type !== 'unauthorized'

    if (isAuthorized) {
      return {
        label: selectedSubscription.name || t('workflow.nodes.triggerPlugin.authorized'),
        color: 'green' as const,
      }
    }
    else {
      return {
        label: t('workflow.nodes.triggerPlugin.notAuthorized'),
        color: 'red' as const,
      }
    }
  }, [selectedSubscription, subscriptions.length, t])

  const statusConfig = getStatusConfig()

  const handleConfigure = useCallback(() => {
    onConfigure()
    setIsOpen(false)
  }, [onConfigure])

  const handleRemove = useCallback((subscriptionId: string) => {
    onRemove(subscriptionId)
    setIsOpen(false)
  }, [onRemove])

  const handleSelectSubscription = useCallback((subscriptionId: string) => {
    onSubscriptionSelect(subscriptionId)
    setIsOpen(false)
  }, [onSubscriptionSelect])

  return (
    <div className={cn('relative', className)}>
      <Button
        size='small'
        variant='ghost'
        className={cn(
          'h-6 px-1.5 py-1',
          'hover:bg-components-button-ghost-bg-hover',
          isOpen && 'bg-components-button-ghost-bg-hover',
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <Indicator
          className='mr-1.5'
          color={statusConfig.color}
        />
        <span className="text-xs font-medium text-components-button-ghost-text">
          {statusConfig.label}
        </span>
        <RiArrowDownSLine
          className='ml-1 h-3.5 w-3.5 text-components-button-ghost-text'
        />
      </Button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-20"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Menu */}
          <div className={cn(
            'absolute right-0 z-30 mt-1',
            'w-[240px] rounded-xl border-[0.5px] border-components-panel-border',
            'bg-components-panel-bg-blur shadow-lg backdrop-blur-sm',
          )}>
            <div className="py-1">
              {/* Subscription list */}
              {subscriptions.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-xs font-medium text-text-tertiary">
                    {t('workflow.nodes.triggerPlugin.availableSubscriptions')}
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {subscriptions.map((subscription) => {
                      const isSelected = subscription.id === selectedSubscriptionId
                      const isAuthorized = subscription.credential_type !== 'unauthorized'
                      return (
                        <button
                          key={subscription.id}
                          className={cn(
                            'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                            'hover:bg-state-base-hover',
                            isSelected && 'bg-state-base-hover',
                          )}
                          onClick={() => handleSelectSubscription(subscription.id)}
                        >
                          <div className="flex items-center gap-2">
                            <Indicator
                              color={isAuthorized ? 'green' : 'red'}
                            />
                            <span className={cn(
                              'text-text-secondary',
                              isSelected && 'font-medium text-text-primary',
                            )}>
                              {subscription.name}
                            </span>
                          </div>
                          {isSelected && (
                            <RiCheckLine className="h-4 w-4 text-text-accent" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <div className="my-1 h-[0.5px] bg-divider-subtle" />
                </>
              )}

              {/* Add new subscription */}
              <button
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  'text-text-secondary hover:bg-state-base-hover',
                )}
                onClick={handleConfigure}
              >
                <RiAddLine className="h-4 w-4" />
                {t('workflow.nodes.triggerPlugin.addSubscription')}
              </button>

              {/* Remove subscription */}
              {selectedSubscription && (
                <>
                  <div className="my-1 h-[0.5px] bg-divider-subtle" />
                  <button
                    className={cn(
                      'block w-full px-3 py-2 text-left text-sm',
                      'text-text-destructive hover:bg-state-destructive-hover',
                    )}
                    onClick={() => handleRemove(selectedSubscription.id)}
                  >
                    {t('workflow.nodes.triggerPlugin.removeSubscription')}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(AuthenticationMenu)
