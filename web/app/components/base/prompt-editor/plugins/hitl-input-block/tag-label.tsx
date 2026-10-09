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
  const Component = onClick ? 'button' : 'span'
  return (
    <Component
      type={onClick ? 'button' : undefined}
      className={cn(
        'inline-flex h-5 cursor-pointer items-center space-x-1 rounded-md bg-components-button-secondary-bg px-1 text-text-accent focus-visible:outline-2 focus-visible:outline-state-accent-solid',
        className,
      )}
      onClick={onClick}
    >
      <span aria-hidden className={cn(iconClassName, 'size-3.5')} />
      <span className="system-xs-medium">{children}</span>
    </Component>
  )
}
export default React.memo(TagLabel)
