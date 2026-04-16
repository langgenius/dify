'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useMemo, useState } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import { MarkdownWithDirective } from '@/app/components/base/markdown-with-directive'
import { Button } from '@/app/components/base/ui/button'

type InSiteMessageAction = 'link' | 'close'
type InSiteMessageButtonType = 'primary' | 'default'

export type InSiteMessageActionItem = {
  action: InSiteMessageAction
  action_name: string // for tracing and analytics
  data?: unknown
  text: string
  type: InSiteMessageButtonType
}

type InSiteMessageProps = {
  notificationId: string
  actions: InSiteMessageActionItem[]
  className?: string
  headerBgUrl?: string
  main: string
  onAction?: (action: InSiteMessageActionItem) => void
  subtitle: string
  title: string
}

const LINE_BREAK_REGEX = /\\n/g

function normalizeLineBreaks(text: string): string {
  return text.replace(LINE_BREAK_REGEX, '\n')
}

function normalizeLinkData(data: unknown): { href: string, rel?: string, target?: string } | null {
  if (typeof data === 'string')
    return { href: data, target: '_blank' }

  if (!data || typeof data !== 'object')
    return null

  const candidate = data as { href?: unknown, rel?: unknown, target?: unknown }
  if (typeof candidate.href !== 'string' || !candidate.href)
    return null

  return {
    href: candidate.href,
    rel: typeof candidate.rel === 'string' ? candidate.rel : undefined,
    target: typeof candidate.target === 'string' ? candidate.target : '_blank',
  }
}

const DEFAULT_HEADER_BG_URL = '/in-site-message/header-bg.svg'

function InSiteMessage({
  notificationId,
  actions,
  className,
  headerBgUrl = DEFAULT_HEADER_BG_URL,
  main,
  onAction,
  subtitle,
  title,
}: InSiteMessageProps) {
  const [visible, setVisible] = useState(true)
  const normalizedTitle = normalizeLineBreaks(title)
  const normalizedSubtitle = normalizeLineBreaks(subtitle)

  const headerStyle = useMemo(() => {
    return {
      backgroundImage: `url(${headerBgUrl || DEFAULT_HEADER_BG_URL})`,
    }
  }, [headerBgUrl])

  useEffect(() => {
    trackEvent('in_site_message_show', {
      notification_id: notificationId,
    })
  }, [notificationId])

  const handleAction = (item: InSiteMessageActionItem) => {
    trackEvent('in_site_message_action', {
      notification_id: notificationId,
      action: item.action_name,
    })
    onAction?.(item)

    if (item.action === 'close') {
      setVisible(false)
      return
    }

    const linkData = normalizeLinkData(item.data)
    if (!linkData)
      return

    const target = linkData.target ?? '_blank'
    if (target === '_self') {
      window.location.assign(linkData.href)
      return
    }

    window.open(linkData.href, target, linkData.rel || 'noopener,noreferrer')
  }

  if (!visible)
    return null

  return (
    <div
      className={cn(
        'fixed right-3 bottom-3 z-50 w-[360px] overflow-hidden rounded-xl border border-components-panel-border-subtle bg-components-panel-bg shadow-2xl backdrop-blur-[5px]',
        className,
      )}
    >
      <div className="flex min-h-[128px] flex-col justify-end gap-0.5 bg-cover px-4 pt-6 pb-3 text-text-primary-on-surface" style={headerStyle}>
        <div className="title-3xl-bold whitespace-pre-line">
          {normalizedTitle}
        </div>
        <div className="body-md-regular whitespace-pre-line">
          {normalizedSubtitle}
        </div>
      </div>

      <div className="px-4 pt-4 pb-2 body-md-regular text-text-secondary">
        <MarkdownWithDirective markdown={main} />
      </div>

      <div className="flex items-center justify-end gap-2 p-4">
        {actions.map(item => (
          <Button
            key={`${item.type}-${item.action}-${item.text}`}
            variant={item.type === 'primary' ? 'primary' : 'ghost'}
            size="medium"
            className={cn(item.type === 'default' && 'text-text-secondary')}
            onClick={() => handleAction(item)}
          >
            {item.text}
          </Button>
        ))}
      </div>
    </div>
  )
}

export default InSiteMessage
