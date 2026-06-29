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
        'flex size-10 items-center justify-center rounded-[10px] border border-divider-subtle bg-background-default-subtle text-text-tertiary shadow-xs',
        className,
      )}
      aria-hidden="true"
    >
      <span className={cn('relative block size-8', graphicClassName)}>
        <span className="absolute top-1/2 left-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-util-colors-blue-blue-500" />
        <span className="absolute top-0.5 left-0.5 size-2.5 rounded-xs bg-util-colors-blue-blue-300 shadow-xs" />
        <span className="absolute top-1/2 right-0.5 size-2.5 -translate-y-1/2 rounded-xs bg-util-colors-blue-blue-600 shadow-xs" />
        <span className="absolute bottom-0.5 left-0.5 size-2.5 rounded-xs bg-util-colors-indigo-indigo-400 shadow-xs" />
      </span>
    </div>
  )
}
