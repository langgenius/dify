'use client'

import type { AppIconProps } from '@/app/components/base/app-icon'
import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Link from '@/next/link'
import useSignInUrl from '../use-sign-in-url'

export type RequiredConnection = {
  id: string
  name: string
  icon?: AppIconProps['icon']
  iconClassName?: string
}

type Props = {
  connections: readonly RequiredConnection[]
  className?: string
}

export default function RequiredConnections({ connections, className }: Props) {
  const { t } = useTranslation(['share'])
  const titleId = useId()
  const signInUrl = useSignInUrl()

  if (connections.length === 0) return null

  return (
    <section
      aria-labelledby={titleId}
      className={cn('flex w-full flex-col items-start', className)}
    >
      <div className="flex w-full flex-col gap-1 pb-6">
        <h2 id={titleId} className="system-md-semibold text-text-primary">
          {t(($) => $['connections.required.title'], { ns: 'share' })}
        </h2>
        <p className="min-h-5 system-xs-regular text-text-tertiary">
          {t(($) => $['connections.required.signInDescription'], { ns: 'share' })}
        </p>
        <ul className="flex w-full flex-wrap gap-x-4 gap-y-2">
          {connections.map((connection) => (
            <li key={connection.id} className="flex max-w-full min-w-0 items-center gap-1.5">
              <AppIcon
                size="tiny"
                className="size-5 rounded-md"
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
              <span className="system-xs-regular wrap-anywhere text-text-tertiary">
                {connection.name}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Link
        href={signInUrl}
        className={cn(
          buttonVariants({ variant: 'primary', size: 'large' }),
          'h-auto min-h-9 w-36 max-w-full py-2 text-center whitespace-normal',
        )}
      >
        {t(($) => $['connections.required.signIn'], { ns: 'share' })}
      </Link>
    </section>
  )
}
