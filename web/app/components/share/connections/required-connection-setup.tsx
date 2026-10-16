'use client'

import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import RequiredServices from './required-services'

export default function RequiredConnectionSetup({
  services,
  onConnect,
  onConnectionChange,
  className,
}: ComponentProps<typeof RequiredServices>) {
  const { t } = useTranslation(['share'])
  const titleId = useId()

  if (services.length === 0) return null

  return (
    <section aria-labelledby={titleId} className={cn('flex w-full flex-col gap-6', className)}>
      <div className="space-y-2">
        <h2 id={titleId} className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['connections.setup.title'], { ns: 'share' })}
        </h2>
        <p className="min-h-5 system-xs-regular text-text-tertiary">
          {t(($) => $['connections.setup.required'], { ns: 'share', count: services.length })}
        </p>
      </div>
      <RequiredServices
        services={services}
        onConnect={onConnect}
        onConnectionChange={onConnectionChange}
      />
    </section>
  )
}
