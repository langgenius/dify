'use client'

import type { FC } from 'react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import cn from '@/utils/classnames'

export type AuthenticationStatus = 'authorized' | 'not_configured' | 'error'

export type AuthSubscription = {
  id: string
  name: string
  status: AuthenticationStatus
  credentials?: Record<string, any>
}

type AuthenticationMenuProps = {
  subscription?: AuthSubscription
  onConfigure: () => void
  onRemove: () => void
  className?: string
}

const AuthenticationMenu: FC<AuthenticationMenuProps> = ({
  subscription,
  onConfigure,
  onRemove,
  className,
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  const getStatusConfig = useCallback(() => {
    if (!subscription) {
      return {
        label: t('workflow.nodes.triggerPlugin.notConfigured'),
        color: 'red' as const,
      }
    }

    switch (subscription.status) {
      case 'authorized':
        return {
          label: t('workflow.nodes.triggerPlugin.authorized'),
          color: 'green' as const,
        }
      case 'error':
        return {
          label: t('workflow.nodes.triggerPlugin.error'),
          color: 'red' as const,
        }
      default:
        return {
          label: t('workflow.nodes.triggerPlugin.notConfigured'),
          color: 'red' as const,
        }
    }
  }, [subscription, t])

  const statusConfig = getStatusConfig()

  const handleConfigure = useCallback(() => {
    onConfigure()
    setIsOpen(false)
  }, [onConfigure])

  const handleRemove = useCallback(() => {
    onRemove()
    setIsOpen(false)
  }, [onRemove])

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
            'w-[136px] rounded-xl border-[0.5px] border-components-panel-border',
            'bg-components-panel-bg-blur shadow-lg backdrop-blur-sm',
          )}>
            <div className="py-1">
              <button
                className={cn(
                  'block w-full px-4 py-2 text-left text-sm',
                  'text-text-secondary hover:bg-state-base-hover',
                  'mx-1 rounded-lg',
                )}
                onClick={handleConfigure}
              >
                {t('workflow.nodes.triggerPlugin.configuration')}
              </button>
              {subscription && subscription.status === 'authorized' && (
                <button
                  className={cn(
                    'block w-full px-4 py-2 text-left text-sm',
                    'text-text-destructive hover:bg-state-destructive-hover',
                    'mx-1 rounded-lg',
                  )}
                  onClick={handleRemove}
                >
                  {t('workflow.nodes.triggerPlugin.remove')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(AuthenticationMenu)
