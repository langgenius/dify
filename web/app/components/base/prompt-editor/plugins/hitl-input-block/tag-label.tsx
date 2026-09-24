'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type Props = Readonly<{
  type: 'edit' | 'variable'
  children: string
  className?: string
  onClick?: () => void
}>

const TagLabel: FC<Props> = ({ type, children, className, onClick }) => {
  const iconClassName =
    type === 'edit' ? 'i-ri-edit-line' : 'i-custom-vender-solid-development-variable-02'
  return (
    <div
      className={cn(
        'inline-flex h-5 cursor-pointer items-center space-x-1 rounded-md bg-components-button-secondary-bg px-1 text-text-accent',
        className,
      )}
      onClick={onClick}
    >
      <span aria-hidden className={cn(iconClassName, 'size-3.5')} />
      <div className="system-xs-medium">{children}</div>
    </div>
  )
}
export default React.memo(TagLabel)
