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
}

const Option = ({
  iconClassName,
  text,
  href,
}: OptionProps) => {
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
