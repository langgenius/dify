'use client'
import { Switch as OriginalSwitch } from '@headlessui/react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type SwitchProps = {
  'value': boolean
  'onChange'?: (value: boolean) => void
  'size'?: 'xs' | 'sm' | 'md' | 'lg' | 'l'
  'disabled'?: boolean
  'className'?: string
  'data-testid'?: string
}

const Switch = (
  {
    ref: propRef,
    value,
    onChange,
    size = 'md',
    disabled = false,
    className,
    'data-testid': dataTestid,
  }: SwitchProps & {
    ref?: React.RefObject<HTMLButtonElement>
  },
) => {
  const wrapStyle = {
    lg: 'h-6 w-11',
    l: 'h-5 w-9',
    md: 'h-4 w-7',
    sm: 'h-3 w-5',
    xs: 'h-2.5 w-3.5',
  }

  const circleStyle = {
    lg: 'h-5 w-5',
    l: 'h-4 w-4',
    md: 'h-3 w-3',
    sm: 'h-2 w-2',
    xs: 'h-1.5 w-1',
  }

  const translateLeft = {
    lg: 'translate-x-5',
    l: 'translate-x-4',
    md: 'translate-x-3',
    sm: 'translate-x-2',
    xs: 'translate-x-1.5',
  }
  return (
    <OriginalSwitch
      ref={propRef}
      checked={value}
      onChange={(checked: boolean) => {
        if (disabled)
          return
        onChange?.(checked)
      }}
      className={cn(wrapStyle[size], value ? 'bg-components-toggle-bg' : 'bg-components-toggle-bg-unchecked', 'relative inline-flex shrink-0 cursor-pointer rounded-[5px] border-2 border-transparent transition-colors duration-200 ease-in-out', disabled ? '!cursor-not-allowed !opacity-50' : '', size === 'xs' && 'rounded-sm', className)}
      data-testid={dataTestid}
    >
      <span
        aria-hidden="true"
        className={cn(circleStyle[size], value ? translateLeft[size] : 'translate-x-0', size === 'xs' && 'rounded-[1px]', 'pointer-events-none inline-block rounded-[3px] bg-components-toggle-knob shadow ring-0 transition duration-200 ease-in-out')}
      />
    </OriginalSwitch>
  )
}

Switch.displayName = 'Switch'

export default React.memo(Switch)
