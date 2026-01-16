'use client'

import type { FC } from 'react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

export type MenuItemProps = {
  icon: React.ElementType
  label: string
  onClick: () => void
  disabled?: boolean
}

const MenuItem: FC<MenuItemProps> = ({ icon: Icon, label, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex w-full items-center gap-2 rounded-lg px-3 py-2',
      'hover:bg-state-base-hover disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
    )}
  >
    <Icon className="size-4 text-text-tertiary" aria-hidden="true" />
    <span className="system-sm-regular text-text-secondary">
      {label}
    </span>
  </button>
)

export default React.memo(MenuItem)
