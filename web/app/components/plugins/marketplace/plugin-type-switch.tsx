'use client'

import { useState } from 'react'
import {
  RiHammerLine,
  RiPuzzle2Line,
} from '@remixicon/react'
import cn from '@/utils/classnames'

type PluginTypeSwitchProps = {
  onChange: (type: string) => void
}
const options = [
  {
    value: 'all',
    text: 'All',
    icon: null,
  },
  {
    value: 'models',
    text: 'Models',
    icon: null,
  },
  {
    value: 'tools',
    text: 'Tools',
    icon: <RiHammerLine className='mr-1.5 w-4 h-4' />,
  },
  {
    value: 'extensions',
    text: 'Extensions',
    icon: <RiPuzzle2Line className='mr-1.5 w-4 h-4' />,
  },
  {
    value: 'bundles',
    text: 'Bundles',
    icon: null,
  },
]
const PluginTypeSwitch = ({
  onChange,
}: PluginTypeSwitchProps) => {
  const [activeType, setActiveType] = useState('all')

  return (
    <div className='flex items-center justify-center space-x-2'>
      {
        options.map(option => (
          <div
            key={option.value}
            className={cn(
              'flex items-center px-3 h-8 border border-transparent rounded-xl cursor-pointer hover:bg-state-base-hover hover:text-text-secondary system-md-medium text-text-tertiary',
              activeType === option.value && 'border-components-main-nav-nav-button-border !bg-components-main-nav-nav-button-bg-active !text-components-main-nav-nav-button-text-active shadow-xs',
            )}
            onClick={() => {
              setActiveType(option.value)
              onChange(option.value)
            }}
          >
            {option.icon}
            {option.text}
          </div>
        ))
      }
    </div>
  )
}

export default PluginTypeSwitch
