'use client'

import { useMemo, useState } from 'react'
import Button from '@/app/components/base/button'
import { MarkdownWithDirective } from '@/app/components/base/markdown-with-directive'
import { cn } from '@/utils/classnames'

type InSiteMessageAction = 'link' | 'close'
type InSiteMessageButtonType = 'primary' | 'default'

export type InSiteMessageActionItem = {
  action: InSiteMessageAction
  data?: unknown
  text: string
  type: InSiteMessageButtonType
}

type InSiteMessageProps = {
  actions: InSiteMessageActionItem[]
  className?: string
  main: string
  subtitle: string
  title: string
  title_pic_url?: string
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

function InSiteMessage({
  actions,
  className,
  main,
  subtitle,
  title,
  title_pic_url,
}: InSiteMessageProps) {
  const [visible, setVisible] = useState(true)

  const headerStyle = useMemo(() => {
    if (!title_pic_url) {
      return {
        background: 'linear-gradient(180deg, #3268f4 0%, #194ccf 100%)',
      }
    }

    return {
      backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.4) 100%), url(${title_pic_url})`,
      backgroundPosition: 'center',
      backgroundSize: 'cover',
    }
  }, [title_pic_url])

  const handleAction = (item: InSiteMessageActionItem) => {
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

    window.open(linkData.href, target, linkData.rel ?? 'noopener,noreferrer')
  }

  if (!visible)
    return null

  return (
    <div
      className={cn(
        'fixed bottom-3 right-3 z-50 w-[360px] overflow-hidden rounded-xl border border-black/5 bg-background-default shadow-2xl',
        className,
      )}
    >
      <div className="flex min-h-[128px] flex-col justify-end gap-0.5 px-4 pb-3 pt-6 text-white" style={headerStyle}>
        <div className="text-[20px] font-bold leading-6">
          {title}
        </div>
        <div className="text-[14px] font-normal leading-5 text-white/95">
          {subtitle}
        </div>
      </div>

      <div className="markdown-body px-4 pb-2 pt-4 text-[14px] leading-5 text-text-secondary">
        <MarkdownWithDirective markdown={main} />
      </div>

      <div className="flex items-center justify-end gap-2 px-4 pb-4 pt-2">
        {actions.map(item => (
          <Button
            key={`${item.type}-${item.action}-${item.text}`}
            variant={item.type === 'primary' ? 'primary' : 'ghost'}
            size="small"
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
