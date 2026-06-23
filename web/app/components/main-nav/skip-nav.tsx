'use client'

import type { ComponentProps, MouseEventHandler } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

export const MAIN_CONTENT_ID = 'main-content'
const MAIN_CONTENT_HREF = `#${MAIN_CONTENT_ID}`

export function SkipNav({
  className,
  children,
  onClick,
  ...props
}: ComponentProps<'a'>) {
  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event)

    if (event.defaultPrevented)
      return

    document.getElementById(MAIN_CONTENT_ID)?.focus()
  }

  return (
    <a
      href={MAIN_CONTENT_HREF}
      onClick={handleClick}
      className={cn(
        'fixed top-2 left-2 z-60 inline-flex h-9 -translate-y-[calc(100%+0.75rem)] items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text outline-hidden transition-transform duration-150 focus-visible:translate-y-0 focus-visible:shadow-lg focus-visible:ring-2 focus-visible:shadow-shadow-shadow-5 focus-visible:ring-state-accent-solid motion-reduce:transition-none',
        className,
      )}
      {...props}
    >
      {children}
    </a>
  )
}
