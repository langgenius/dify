'use client'

import type { AppIconProps } from '@/app/components/base/app-icon'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import useWebAppSignIn from '../use-webapp-sign-in'

export type RequiredConnection = {
  id: string
  name: string
  icon?: AppIconProps['icon']
  iconClassName?: string
}

type Props = {
  connections: readonly RequiredConnection[]
  className?: string
  showSignIn?: boolean
  size?: 'small' | 'medium'
}

export default function RequiredConnections({
  connections,
  className,
  showSignIn = true,
  size = 'small',
}: Props) {
  const { t } = useTranslation(['share', 'common'])
  const titleId = useId()
  const { signIn, pending, error } = useWebAppSignIn()

  if (connections.length === 0) return null

  return (
    <section
      aria-labelledby={titleId}
      className={cn('flex w-full flex-col items-start', className)}
    >
      <div className={cn('flex w-full flex-col', size === 'medium' ? 'gap-2 pb-5' : 'gap-1 pb-6')}>
        <h2
          id={titleId}
          className={cn(
            'text-text-primary',
            size === 'medium' ? 'system-xl-semibold' : 'system-md-semibold',
          )}
        >
          {t(($) => $['connections.required.title'], { ns: 'share' })}
        </h2>
        {showSignIn && (
          <p
            className={cn(
              'min-h-5 text-text-tertiary',
              size === 'medium' ? 'system-sm-regular' : 'system-xs-regular',
            )}
          >
            {t(($) => $['connections.required.signInDescription'], { ns: 'share' })}
          </p>
        )}
        <ul className="flex w-full flex-wrap gap-x-4 gap-y-2">
          {connections.map((connection) => (
            <li key={connection.id} className="flex max-w-full min-w-0 items-center gap-1.5">
              <AppIcon
                size="tiny"
                className={cn('rounded-md', size === 'small' && 'size-5')}
                icon={connection.icon}
                fallback={{
                  content: (
                    <span
                      className={cn(
                        'size-4 text-text-secondary',
                        connection.iconClassName ?? 'i-ri-plug-line',
                      )}
                    />
                  ),
                  background: 'var(--color-background-default-dodge)',
                }}
                decorative
              />
              <span
                className={cn(
                  'wrap-anywhere text-text-tertiary',
                  size === 'medium' ? 'system-sm-regular' : 'system-xs-regular',
                )}
              >
                {connection.name}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {showSignIn && (
        <Button
          variant="primary"
          size="large"
          onClick={signIn}
          loading={pending}
          className={cn('h-auto min-h-9 w-36 max-w-full py-2 text-center whitespace-normal')}
        >
          {t(($) => $['connections.required.signIn'], { ns: 'share' })}
        </Button>
      )}
      {showSignIn && error && (
        <p role="alert">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
      )}
    </section>
  )
}
