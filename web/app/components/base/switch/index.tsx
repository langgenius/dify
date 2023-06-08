'use client'
import React, { useEffect, useState } from 'react'
import classNames from 'classnames'
import { Switch as OriginalSwitch } from '@headlessui/react'

type SwitchProps = {
  onChange: (value: boolean) => void
  size?: 'md' | 'lg'
  defaultValue?: boolean
  disabled?: boolean
}

const Switch = ({ onChange, size = 'lg', defaultValue = false, disabled = false }: SwitchProps) => {
  const [enabled, setEnabled] = useState(defaultValue)
  useEffect(() => {
    setEnabled(defaultValue)
  }, [defaultValue])
  const wrapStyle = {
    lg: 'h-6 w-11',
    md: 'h-4 w-7',
  }

  const circleStyle = {
    lg: 'h-5 w-5',
    md: 'h-3 w-3',
  }

  const translateLeft = {
    lg: 'translate-x-5',
    md: 'translate-x-3',
  }
  return (
    <OriginalSwitch
      checked={enabled}
      onChange={(checked: boolean) => {
        if (disabled)
          return
        setEnabled(checked)
        onChange(checked)
      }}
      className={classNames(
        wrapStyle[size],
        enabled ? 'bg-blue-600' : 'bg-gray-200',
        'relative inline-flex  flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
        disabled ? '!opacity-50 !cursor-not-allowed' : '',
      )}
    >
      <span
        aria-hidden="true"
        className={classNames(
          circleStyle[size],
          enabled ? translateLeft[size] : 'translate-x-0',
          'pointer-events-none inline-block transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
        )}
      />
    </OriginalSwitch>
  )
}
export default React.memo(Switch)
