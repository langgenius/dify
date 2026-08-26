'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

export function LegacyAgentBadge() {
  const { t } = useTranslation()
  const description = t(($) => $['legacyAgentBadge.description'], { ns: 'appDebug' })

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        closeDelay={200}
        type="button"
        className="inline-flex h-5 shrink-0 cursor-pointer items-center gap-0.5 rounded-[5px] border border-text-warning bg-components-badge-bg-dimm px-1.25 system-2xs-medium-uppercase whitespace-nowrap text-text-warning outline-hidden hover:bg-state-warning-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <span aria-hidden className="i-ri-alert-fill size-3 shrink-0" />
        {t(($) => $['legacyAgentBadge.label'], { ns: 'appDebug' })}
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-start"
        sideOffset={6}
        className="max-w-[300px] px-3 py-2 system-xs-regular text-text-tertiary"
      >
        <div>{description}</div>
        <Link
          href="/agents"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-0.5 rounded-md system-xs-medium text-text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span>{t(($) => $['legacyAgentBadge.action'], { ns: 'appDebug' })}</span>
          <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
        </Link>
      </PopoverContent>
    </Popover>
  )
}
