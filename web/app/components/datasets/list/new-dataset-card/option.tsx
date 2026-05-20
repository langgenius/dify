import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import Link from '@/next/link'

type OptionProps = {
  Icon: React.ComponentType<{ className?: string }>
  text: string
  href: string
  disabled?: boolean
}

const Option = ({
  Icon,
  text,
  href,
  disabled = false,
}: OptionProps) => {
  if (disabled) {
    return (
      <div
        className={cn(
          'flex w-full cursor-not-allowed items-center gap-x-2 rounded-lg bg-transparent px-4 py-2 text-text-tertiary opacity-50 shadow-shadow-shadow-3',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="grow text-left system-sm-medium">{text}</span>
      </div>
    )
  }

  return (
    <Link
      type="button"
      className="flex w-full items-center gap-x-2 rounded-lg bg-transparent px-4 py-2 text-text-tertiary shadow-shadow-shadow-3 hover:bg-background-default-dodge hover:text-text-secondary hover:shadow-xs"
      href={href}
    >
      <Icon className="size-4 shrink-0" />
      <span className="grow text-left system-sm-medium">{text}</span>
    </Link>
  )
}

export default React.memo(Option)
