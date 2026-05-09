'use client'

import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { continueWorkItems } from './data'

type ContinueWorkProps = {
  className?: string
}

const ContinueWork = ({
  className,
}: ContinueWorkProps) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()

  return (
    <section className={cn('px-12', className)} aria-labelledby="continue-work-title">
      <div className="flex items-center justify-between">
        <h2 id="continue-work-title" className="min-w-0 truncate system-xl-semibold text-text-primary">
          {t('continueWork.title', { ns: 'explore' })}
        </h2>
        <Link
          href="/apps"
          className="ml-4 shrink-0 system-sm-medium text-text-accent"
        >
          {t('continueWork.exploreStudio', { ns: 'explore' })}
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2 xl:grid-cols-4">
        {continueWorkItems.map(item => (
          <article
            key={item.id}
            className="flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-4 pt-4 pb-3 shadow-md"
          >
            <div className="relative shrink-0">
              <div className={cn(
                'flex size-10 items-center justify-center rounded-lg border-[0.5px] border-divider-regular text-2xl leading-none',
                item.avatarClassName,
              )}
              >
                <span aria-hidden>{item.emoji}</span>
              </div>
              <AppTypeIcon
                type={item.mode}
                wrapperClassName="absolute -right-0.5 -bottom-0.5 size-4 rounded-xs border-components-panel-on-panel-item-bg shadow-sm"
                className="size-3"
              />
            </div>
            <div className="min-w-0 py-px">
              <h3 className="truncate system-md-semibold text-text-secondary" title={item.title}>
                {item.title}
              </h3>
              <div className="flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary">
                <span className="shrink-0">{item.author}</span>
                <span className="shrink-0">·</span>
                <span className="min-w-0 truncate">{t('continueWork.editedAt', { ns: 'explore', time: formatTimeFromNow(item.updatedAt) })}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default React.memo(ContinueWork)
