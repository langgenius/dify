'use client'
import React, { useEffect, useState } from 'react'
import { Switch as OriginalSwitch } from '@headlessui/react'
import classNames from '@/utils/classnames'

type SwitchProps = {
  onChange?: (value: boolean) => void
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'l'
  defaultValue?: boolean
  disabled?: boolean
  className?: string
}

const Switch = (
  {
    ref: propRef,
    onChange,
    size = 'md',
    defaultValue = false,
    disabled = false,
    className,
  }: SwitchProps & {
    ref?: React.RefObject<HTMLButtonElement>;
  },
) => {
  const [enabled, setEnabled] = useState(defaultValue)
  useEffect(() => {
    setEnabled(defaultValue)
  }, [defaultValue])
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
      checked={enabled}
      onChange={(checked: boolean) => {
        if (disabled)
          return
        setEnabled(checked)
        onChange?.(checked)
      }}
      className={classNames(
        wrapStyle[size],
        enabled ? 'bg-components-toggle-bg' : 'bg-components-toggle-bg-unchecked',
        'relative inline-flex  shrink-0 cursor-pointer rounded-[5px] border-2 border-transparent transition-colors duration-200 ease-in-out',
        disabled ? '!cursor-not-allowed !opacity-50' : '',
        size === 'xs' && 'rounded-sm',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={classNames(
          circleStyle[size],
          enabled ? translateLeft[size] : 'translate-x-0',
          size === 'xs' && 'rounded-[1px]',
          'pointer-events-none inline-block rounded-[3px] bg-components-toggle-knob shadow ring-0 transition duration-200 ease-in-out',
        )}
      />
    </OriginalSwitch>
  )
}

Switch.displayName = 'Switch'

export default React.memo(Switch)
