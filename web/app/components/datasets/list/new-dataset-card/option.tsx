import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import {
  createResourceCardActionClassName,
  createResourceCardActionIconClassName,
} from '@/app/components/base/create-resource-card'
import Link from '@/next/link'

type OptionProps = {
  iconClassName: string
  text: string
  href: string
  disabled?: boolean
}

const Option = ({
  iconClassName,
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
        <span aria-hidden="true" className={cn(iconClassName, 'h-4 w-4 shrink-0')} />
        <span className="grow text-left system-sm-medium">{text}</span>
      </div>
    )
  }

  return (
    <Link
      type="button"
      className={createResourceCardActionClassName}
      href={href}
    >
      <span aria-hidden="true" className={cn(iconClassName, createResourceCardActionIconClassName)} />
      <span className="min-w-0 grow truncate">{text}</span>
    </Link>
  )
}

export default React.memo(Option)
