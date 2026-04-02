'use client'

import { cn } from '@/utils/classnames'

export type CategoryOption = {
  value: string
  text: string
  icon: React.ReactNode | null
}

type CategorySwitchProps = {
  className?: string
  variant?: 'default' | 'hero'
  options: CategoryOption[]
  activeValue: string
  onChange: (value: string) => void
}

export const CommonCategorySwitch = ({
  className,
  variant = 'default',
  options,
  activeValue,
  onChange,
}: CategorySwitchProps) => {
  const isHeroVariant = variant === 'hero'

  const getItemClassName = (isActive: boolean) => {
    if (isHeroVariant) {
      return cn(
        'system-md-medium flex h-8 cursor-pointer items-center rounded-lg px-3 text-text-primary-on-surface transition-all',
        isActive
          ? 'bg-components-button-secondary-bg text-saas-dify-blue-inverted'
          : 'hover:bg-state-base-hover',
      )
    }
    return cn(
      'system-md-medium flex h-8 cursor-pointer items-center rounded-xl border border-transparent px-3 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
      isActive && 'border-components-main-nav-nav-button-border !bg-components-main-nav-nav-button-bg-active !text-components-main-nav-nav-button-text-active shadow-xs',
    )
  }

  return (
    <div className={cn(
      'flex shrink-0 items-center space-x-2',
      !isHeroVariant && 'justify-center bg-background-body py-3',
      className,
    )}
    >
      {
        options.map(option => (
          <div
            key={option.value}
            className={getItemClassName(activeValue === option.value)}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.text}
          </div>
        ))
      }
    </div>
  )
}
