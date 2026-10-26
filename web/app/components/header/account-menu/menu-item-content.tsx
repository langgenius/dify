import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type MenuItemContentProps = {
  iconClassName: string
  label: ReactNode
  trailing?: ReactNode
}

export function MenuItemContent({ iconClassName, label, trailing }: MenuItemContentProps) {
  const labelTitle = typeof label === 'string' ? label : undefined

  return (
    <>
      <span aria-hidden className={cn('size-4 shrink-0 text-text-tertiary', iconClassName)} />
      <div
        className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary"
        title={labelTitle}
      >
        {label}
      </div>
      {trailing}
    </>
  )
}

export function ExternalLinkIndicator() {
  return (
    <span
      aria-hidden
      className="i-ri-arrow-right-up-line size-3.5 shrink-0 text-text-tertiary [&:dir(rtl)]:-scale-x-100"
    />
  )
}
