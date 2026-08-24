'use client'

import { cn } from '@langgenius/dify-ui/cn'

type SnippetPlaceholderIconProps = {
  className?: string
  graphicClassName?: string
}

export function SnippetPlaceholderIcon({
  className,
  graphicClassName,
}: SnippetPlaceholderIconProps) {
  return (
    <div
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-divider-subtle bg-state-accent-hover text-[#5D6FBB] shadow-xs',
        className,
      )}
      aria-hidden="true"
    >
      <span className={cn('i-ri-braces-line size-6', graphicClassName)} />
    </div>
  )
}
