'use client'
import type { FC, ReactNode } from 'react'
import { cn } from '@/utils/classnames'

type StartNodeOptionProps = {
  icon: ReactNode
  title: string
  subtitle?: string
  description: string
  onClick: () => void
}

const StartNodeOption: FC<StartNodeOptionProps> = ({
  icon,
  title,
  subtitle,
  description,
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        'hover:border-components-panel-border-active flex h-40 w-[280px] cursor-pointer flex-col gap-2 rounded-xl border-[0.5px] border-components-option-card-option-border bg-components-panel-on-panel-item-bg p-4 shadow-sm transition-all hover:shadow-md',
      )}
    >
      {/* Icon */}
      <div className="shrink-0">
        {icon}
      </div>

      {/* Text content */}
      <div className="flex h-[74px] flex-col gap-1 py-0.5">
        <div className="h-5 leading-5">
          <h3 className="system-md-semi-bold text-text-primary">
            {title}
            {subtitle && (
              <span className="system-md-regular text-text-quaternary">
                {' '}
                {subtitle}
              </span>
            )}
          </h3>
        </div>

        <div className="h-12 leading-4">
          <p className="system-xs-regular text-text-tertiary">
            {description}
          </p>
        </div>
      </div>
    </div>
  )
}

export default StartNodeOption
